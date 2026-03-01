from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, List
import uuid
import os
import tempfile
import json
import time
from services.face_preprocessing import FacePreprocessor
from services.optimized_face_comparator import OptimizedFaceComparator
from services.redis_streams import RedisStreamManager
from config.kyc_config import API_HOST, API_PORT

# Inicializar FastAPI
app = FastAPI(
    title="KYC Service - Optimized",
    description="Serviço de verificação facial otimizado com UUID e cache",
    version="2.0.0"
)

# Configurar CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inicializar serviços
face_preprocessor = FacePreprocessor()
face_comparator = OptimizedFaceComparator()

# Configurar Redis Streams
redis_config = {
    'host': 'localhost',
    'port': 6379,
    'db': 0,
    'password': None
}
redis_streams = RedisStreamManager(redis_config)

# Modelos Pydantic
class ProfileImageUpload(BaseModel):
    user_id: str
    image_path: str

class VerificationRequest(BaseModel):
    user_id: str
    current_image_path: str

class VerificationResponse(BaseModel):
    success: bool
    user_id: str
    is_match: bool
    similarity_score: float
    confidence: str
    processing_time: float
    error: Optional[str] = None

class BatchVerificationRequest(BaseModel):
    user_ids: List[str]
    current_image_path: str

class BatchVerificationResponse(BaseModel):
    results: Dict[str, VerificationResponse]
    best_match: Optional[str]
    best_score: float
    total_compared: int

# Endpoints da API

@app.post("/upload_profile_image")
async def upload_profile_image(
    user_id: str,
    image: UploadFile = File(...)
):
    """Upload e pré-processamento de imagem de perfil"""
    try:
        # Validar user_id (deve ser UUID válido)
        try:
            uuid.UUID(user_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="user_id deve ser um UUID válido")
        
        # Validar tipo de arquivo
        if not image.content_type.startswith('image/'):
            raise HTTPException(status_code=400, detail="Arquivo deve ser uma imagem")
        
        # Salvar arquivo temporário
        with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as temp_file:
            content = await image.read()
            temp_file.write(content)
            temp_path = temp_file.name
        
        try:
            # Pré-processar imagem
            result = face_preprocessor.preprocess_profile_image(user_id, temp_path)
            
            if result["success"]:
                # Publicar evento no Redis Stream
                await redis_streams.publish_event("kyc:profile_uploaded", {
                    "user_id": user_id,
                    "timestamp": int(time.time()),
                    "image_size": len(content),
                    "processing_result": result
                })
                
                return {
                    "success": True,
                    "user_id": user_id,
                    "message": "Imagem de perfil processada com sucesso",
                    "encodings_saved": True,
                    "metadata": result["metadata"]
                }
            else:
                raise HTTPException(status_code=500, detail=result["error"])
                
        finally:
            # Limpar arquivo temporário
            if os.path.exists(temp_path):
                os.unlink(temp_path)
                
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro interno: {str(e)}")

@app.post("/verify_driver", response_model=VerificationResponse)
async def verify_driver(
    user_id: str,
    current_image: UploadFile = File(...)
):
    """Verificação facial otimizada do motorista"""
    start_time = time.time()
    
    try:
        # Validar user_id
        try:
            uuid.UUID(user_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="user_id deve ser um UUID válido")
        
        # Validar tipo de arquivo
        if not current_image.content_type.startswith('image/'):
            raise HTTPException(status_code=400, detail="Arquivo deve ser uma imagem")
        
        # Salvar arquivo temporário
        with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as temp_file:
            content = await current_image.read()
            temp_file.write(content)
            temp_path = temp_file.name
        
        try:
            # Verificar se encodings existem
            stored_encodings = face_preprocessor.get_face_encodings(user_id)
            if not stored_encodings:
                raise HTTPException(
                    status_code=404, 
                    detail="Encodings faciais não encontrados. Faça upload da imagem de perfil primeiro."
                )
            
            # Comparar faces
            comparison_result = face_comparator.compare_with_stored_encodings(user_id, temp_path)
            
            if not comparison_result["success"]:
                raise HTTPException(status_code=500, detail=comparison_result["error"])
            
            processing_time = time.time() - start_time
            
            # Publicar evento no Redis Stream
            await redis_streams.publish_event("kyc:verification_completed", {
                "user_id": user_id,
                "timestamp": int(time.time()),
                "is_match": comparison_result["is_match"],
                "similarity_score": comparison_result["similarity_score"],
                "confidence": comparison_result["confidence"],
                "processing_time": processing_time
            })
            
            return VerificationResponse(
                success=True,
                user_id=user_id,
                is_match=comparison_result["is_match"],
                similarity_score=comparison_result["similarity_score"],
                confidence=comparison_result["confidence"],
                processing_time=processing_time
            )
            
        finally:
            # Limpar arquivo temporário
            if os.path.exists(temp_path):
                os.unlink(temp_path)
                
    except HTTPException:
        raise
    except Exception as e:
        processing_time = time.time() - start_time
        return VerificationResponse(
            success=False,
            user_id=user_id,
            is_match=False,
            similarity_score=0.0,
            confidence="Erro",
            processing_time=processing_time,
            error=str(e)
        )

@app.post("/batch_verify", response_model=BatchVerificationResponse)
async def batch_verify_drivers(
    user_ids: List[str],
    current_image: UploadFile = File(...)
):
    """Verificação em lote de múltiplos motoristas"""
    start_time = time.time()
    
    try:
        # Validar user_ids
        for user_id in user_ids:
            try:
                uuid.UUID(user_id)
            except ValueError:
                raise HTTPException(status_code=400, detail=f"user_id inválido: {user_id}")
        
        # Validar tipo de arquivo
        if not current_image.content_type.startswith('image/'):
            raise HTTPException(status_code=400, detail="Arquivo deve ser uma imagem")
        
        # Salvar arquivo temporário
        with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as temp_file:
            content = await current_image.read()
            temp_file.write(content)
            temp_path = temp_file.name
        
        try:
            # Verificação em lote
            batch_result = face_comparator.batch_compare(user_ids, temp_path)
            
            processing_time = time.time() - start_time
            
            # Publicar evento no Redis Stream
            await redis_streams.publish_event("kyc:batch_verification_completed", {
                "user_ids": user_ids,
                "timestamp": int(time.time()),
                "best_match": batch_result["best_match"],
                "best_score": batch_result["best_score"],
                "processing_time": processing_time
            })
            
            return BatchVerificationResponse(
                results=batch_result["results"],
                best_match=batch_result["best_match"],
                best_score=batch_result["best_score"],
                total_compared=batch_result["total_compared"]
            )
            
        finally:
            # Limpar arquivo temporário
            if os.path.exists(temp_path):
                os.unlink(temp_path)
                
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro interno: {str(e)}")

@app.get("/encodings/{user_id}")
async def get_face_encodings(user_id: str):
    """Recupera encodings faciais de um usuário"""
    try:
        uuid.UUID(user_id)  # Validar UUID
    except ValueError:
        raise HTTPException(status_code=400, detail="user_id deve ser um UUID válido")
    
    encodings = face_preprocessor.get_face_encodings(user_id)
    
    if encodings:
        return {
            "success": True,
            "user_id": user_id,
            "encodings": encodings
        }
    else:
        raise HTTPException(status_code=404, detail="Encodings não encontrados")

@app.delete("/encodings/{user_id}")
async def delete_face_encodings(user_id: str):
    """Remove encodings faciais de um usuário"""
    try:
        uuid.UUID(user_id)  # Validar UUID
    except ValueError:
        raise HTTPException(status_code=400, detail="user_id deve ser um UUID válido")
    
    success = face_preprocessor.delete_face_encodings(user_id)
    
    if success:
        return {
            "success": True,
            "user_id": user_id,
            "message": "Encodings removidos com sucesso"
        }
    else:
        raise HTTPException(status_code=500, detail="Erro ao remover encodings")

@app.get("/stats")
async def get_service_stats():
    """Retorna estatísticas do serviço"""
    try:
        preprocessor_stats = face_preprocessor.get_encoding_stats()
        comparator_stats = face_comparator.get_comparison_stats()
        
        return {
            "service": "KYC Optimized Service",
            "version": "2.0.0",
            "timestamp": int(time.time()),
            "preprocessor_stats": preprocessor_stats,
            "comparator_stats": comparator_stats
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao obter estatísticas: {str(e)}")

@app.get("/health")
async def health_check():
    """Verificação de saúde do serviço"""
    try:
        # Testar conexão Redis
        redis_status = redis_streams.redis_client.ping()
        
        return {
            "status": "healthy" if redis_status else "unhealthy",
            "timestamp": int(time.time()),
            "redis_connected": redis_status,
            "services": {
                "face_preprocessor": "active",
                "face_comparator": "active",
                "redis_streams": "active" if redis_status else "inactive"
            }
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "timestamp": int(time.time()),
            "error": str(e)
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=API_HOST, port=API_PORT)
