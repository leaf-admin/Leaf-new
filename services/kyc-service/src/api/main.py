"""
FastAPI REST API for KYC Service
Provides HTTP endpoints for face verification
"""

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
import logging
import asyncio
import base64
import io
from PIL import Image
import numpy as np
import cv2
import uuid
import time
from datetime import datetime

from .services.face_detection import FaceDetectionService, VerificationResult, VerificationStatus
from .services.anti_spoofing import AntiSpoofingService, LivenessResult, LivenessStatus
from .services.redis_streams import RedisStreamsManager, MessageType

logger = logging.getLogger(__name__)

# Pydantic models
class VerificationRequest(BaseModel):
    """Verification request model"""
    driver_id: str = Field(..., description="Driver ID")
    session_id: str = Field(..., description="Session ID")
    image_data: str = Field(..., description="Base64 encoded image data")
    profile_image: str = Field(..., description="Base64 encoded profile image")
    verification_type: str = Field(default="face_verification", description="Type of verification")

class VerificationResponse(BaseModel):
    """Verification response model"""
    message_id: str = Field(..., description="Message ID")
    driver_id: str = Field(..., description="Driver ID")
    session_id: str = Field(..., description="Session ID")
    status: str = Field(..., description="Verification status")
    confidence: float = Field(..., description="Confidence score")
    match_score: float = Field(..., description="Face match score")
    quality_score: float = Field(..., description="Image quality score")
    liveness_score: float = Field(..., description="Liveness detection score")
    message: str = Field(..., description="Status message")
    timestamp: float = Field(..., description="Response timestamp")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")

class StatusResponse(BaseModel):
    """Status response model"""
    status: str = Field(..., description="Service status")
    timestamp: float = Field(..., description="Response timestamp")
    version: str = Field(..., description="Service version")
    uptime: float = Field(..., description="Service uptime in seconds")

class HealthResponse(BaseModel):
    """Health check response model"""
    healthy: bool = Field(..., description="Health status")
    services: Dict[str, bool] = Field(..., description="Service health status")
    timestamp: float = Field(..., description="Response timestamp")

# Initialize FastAPI app
app = FastAPI(
    title="KYC Face Verification Service",
    description="Real-time face verification and liveness detection for Leaf drivers",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global services
face_detection_service = None
anti_spoofing_service = None
redis_streams_manager = None
start_time = time.time()

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    global face_detection_service, anti_spoofing_service, redis_streams_manager
    
    try:
        logger.info("Starting KYC service...")
        
        # Initialize face detection service
        face_detection_service = FaceDetectionService()
        logger.info("Face detection service initialized")
        
        # Initialize anti-spoofing service
        anti_spoofing_service = AntiSpoofingService()
        logger.info("Anti-spoofing service initialized")
        
        # Initialize Redis Streams manager
        redis_config = {
            "host": "localhost",
            "port": 6379,
            "db": 0,
            "password": None
        }
        redis_streams_manager = RedisStreamsManager(redis_config)
        await redis_streams_manager.connect()
        logger.info("Redis Streams manager initialized")
        
        logger.info("KYC service started successfully")
        
    except Exception as e:
        logger.error(f"Error starting KYC service: {e}")
        raise

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup services on shutdown"""
    global face_detection_service, anti_spoofing_service, redis_streams_manager
    
    try:
        logger.info("Shutting down KYC service...")
        
        if face_detection_service:
            face_detection_service.cleanup()
        
        if anti_spoofing_service:
            anti_spoofing_service.cleanup()
        
        if redis_streams_manager:
            await redis_streams_manager.cleanup()
        
        logger.info("KYC service shutdown complete")
        
    except Exception as e:
        logger.error(f"Error during shutdown: {e}")

@app.get("/", response_model=StatusResponse)
async def root():
    """Root endpoint"""
    return StatusResponse(
        status="running",
        timestamp=time.time(),
        version="1.0.0",
        uptime=time.time() - start_time
    )

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    try:
        services = {
            "face_detection": face_detection_service is not None,
            "anti_spoofing": anti_spoofing_service is not None,
            "redis_streams": redis_streams_manager is not None
        }
        
        healthy = all(services.values())
        
        return HealthResponse(
            healthy=healthy,
            services=services,
            timestamp=time.time()
        )
        
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return HealthResponse(
            healthy=False,
            services={},
            timestamp=time.time()
        )

@app.post("/verify", response_model=VerificationResponse)
async def verify_face(request: VerificationRequest):
    """
    Verify face against profile image
    
    Args:
        request: Verification request
        
    Returns:
        Verification response
    """
    try:
        logger.info(f"Processing verification request for driver: {request.driver_id}")
        
        # Decode images
        current_image = decode_base64_image(request.image_data)
        profile_image = decode_base64_image(request.profile_image)
        
        if current_image is None or profile_image is None:
            raise HTTPException(status_code=400, detail="Invalid image data")
        
        # Detect faces in current image
        current_faces = face_detection_service.detect_faces(current_image)
        if not current_faces:
            return VerificationResponse(
                message_id=str(uuid.uuid4()),
                driver_id=request.driver_id,
                session_id=request.session_id,
                status="failed",
                confidence=0.0,
                match_score=0.0,
                quality_score=0.0,
                liveness_score=0.0,
                message="No face detected in current image",
                timestamp=time.time(),
                metadata={"error": "no_face_detected"}
            )
        
        # Get the best quality face
        best_face = max(current_faces, key=lambda f: f.quality_score)
        
        # Extract face region
        x, y, w, h = best_face.bbox
        face_roi = current_image[y:y+h, x:x+w]
        
        # Compare faces
        match_score = face_detection_service.compare_faces(face_roi, profile_image)
        
        # Detect liveness
        liveness_result = anti_spoofing_service.detect_liveness(current_image)
        
        # Determine overall status
        if (match_score > 0.7 and 
            best_face.quality_score > 0.5 and 
            liveness_result.confidence > 0.6):
            status = "success"
            message = "Face verification successful"
        elif (match_score > 0.5 and 
              best_face.quality_score > 0.3 and 
              liveness_result.confidence > 0.4):
            status = "pending"
            message = "Verification in progress"
        else:
            status = "failed"
            message = "Face verification failed"
        
        # Create response
        response = VerificationResponse(
            message_id=str(uuid.uuid4()),
            driver_id=request.driver_id,
            session_id=request.session_id,
            status=status,
            confidence=(match_score + best_face.quality_score + liveness_result.confidence) / 3,
            match_score=match_score,
            quality_score=best_face.quality_score,
            liveness_score=liveness_result.confidence,
            message=message,
            timestamp=time.time(),
            metadata={
                "face_count": len(current_faces),
                "liveness_status": liveness_result.status.value,
                "liveness_method": liveness_result.method,
                "verification_type": request.verification_type
            }
        )
        
        # Send to Redis Streams
        if redis_streams_manager:
            await redis_streams_manager.send_verification_response(
                response.message_id,
                request.driver_id,
                request.session_id,
                response.dict()
            )
        
        logger.info(f"Verification completed for driver: {request.driver_id}, status: {status}")
        return response
        
    except Exception as e:
        logger.error(f"Error in face verification: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/verify-stream")
async def verify_face_stream(
    background_tasks: BackgroundTasks,
    driver_id: str = Form(...),
    session_id: str = Form(...),
    image: UploadFile = File(...),
    profile_image: UploadFile = File(...)
):
    """
    Verify face using file uploads (for testing)
    
    Args:
        driver_id: Driver ID
        session_id: Session ID
        image: Current image file
        profile_image: Profile image file
        
    Returns:
        Verification response
    """
    try:
        # Read image files
        current_image_data = await image.read()
        profile_image_data = await profile_image.read()
        
        # Convert to numpy arrays
        current_image = cv2.imdecode(np.frombuffer(current_image_data, np.uint8), cv2.IMREAD_COLOR)
        profile_image = cv2.imdecode(np.frombuffer(profile_image_data, np.uint8), cv2.IMREAD_COLOR)
        
        if current_image is None or profile_image is None:
            raise HTTPException(status_code=400, detail="Invalid image files")
        
        # Process verification
        background_tasks.add_task(
            process_verification_async,
            driver_id,
            session_id,
            current_image,
            profile_image
        )
        
        return JSONResponse(
            status_code=202,
            content={
                "message": "Verification started",
                "driver_id": driver_id,
                "session_id": session_id,
                "timestamp": time.time()
            }
        )
        
    except Exception as e:
        logger.error(f"Error in stream verification: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/liveness-check")
async def check_liveness(
    driver_id: str = Form(...),
    session_id: str = Form(...),
    image: UploadFile = File(...)
):
    """
    Check liveness of face in image
    
    Args:
        driver_id: Driver ID
        session_id: Session ID
        image: Image file
        
    Returns:
        Liveness check result
    """
    try:
        # Read image file
        image_data = await image.read()
        image_array = cv2.imdecode(np.frombuffer(image_data, np.uint8), cv2.IMREAD_COLOR)
        
        if image_array is None:
            raise HTTPException(status_code=400, detail="Invalid image file")
        
        # Detect liveness
        liveness_result = anti_spoofing_service.detect_liveness(image_array)
        
        return JSONResponse(
            status_code=200,
            content={
                "driver_id": driver_id,
                "session_id": session_id,
                "status": liveness_result.status.value,
                "confidence": liveness_result.confidence,
                "method": liveness_result.method,
                "message": liveness_result.message,
                "timestamp": time.time(),
                "metadata": liveness_result.metadata
            }
        )
        
    except Exception as e:
        logger.error(f"Error in liveness check: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/status/{driver_id}/{session_id}")
async def get_verification_status(driver_id: str, session_id: str):
    """
    Get verification status for driver/session
    
    Args:
        driver_id: Driver ID
        session_id: Session ID
        
    Returns:
        Status updates
    """
    try:
        if not redis_streams_manager:
            raise HTTPException(status_code=503, detail="Redis Streams not available")
        
        # Get status updates
        updates = await redis_streams_manager.consume_status_updates(
            driver_id, session_id, timeout=5
        )
        
        return JSONResponse(
            status_code=200,
            content={
                "driver_id": driver_id,
                "session_id": session_id,
                "updates": [update.dict() for update in updates],
                "timestamp": time.time()
            }
        )
        
    except Exception as e:
        logger.error(f"Error getting status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Helper functions
def decode_base64_image(image_data: str) -> Optional[np.ndarray]:
    """Decode base64 image to numpy array"""
    try:
        # Remove data URL prefix if present
        if ',' in image_data:
            image_data = image_data.split(',')[1]
        
        # Decode base64
        image_bytes = base64.b64decode(image_data)
        
        # Convert to PIL Image
        pil_image = Image.open(io.BytesIO(image_bytes))
        
        # Convert to numpy array
        image_array = np.array(pil_image)
        
        # Convert RGB to BGR for OpenCV
        if len(image_array.shape) == 3 and image_array.shape[2] == 3:
            image_array = cv2.cvtColor(image_array, cv2.COLOR_RGB2BGR)
        
        return image_array
        
    except Exception as e:
        logger.error(f"Error decoding base64 image: {e}")
        return None

async def process_verification_async(driver_id: str, session_id: str, 
                                   current_image: np.ndarray, profile_image: np.ndarray):
    """Process verification asynchronously"""
    try:
        # Detect faces
        current_faces = face_detection_service.detect_faces(current_image)
        if not current_faces:
            await redis_streams_manager.send_status_update(
                driver_id, session_id, "failed", "No face detected"
            )
            return
        
        # Get best face
        best_face = max(current_faces, key=lambda f: f.quality_score)
        
        # Extract face region
        x, y, w, h = best_face.bbox
        face_roi = current_image[y:y+h, x:x+w]
        
        # Compare faces
        match_score = face_detection_service.compare_faces(face_roi, profile_image)
        
        # Detect liveness
        liveness_result = anti_spoofing_service.detect_liveness(current_image)
        
        # Send result
        result = {
            "status": "success" if match_score > 0.7 else "failed",
            "confidence": match_score,
            "match_score": match_score,
            "quality_score": best_face.quality_score,
            "liveness_score": liveness_result.confidence,
            "message": "Verification completed"
        }
        
        await redis_streams_manager.send_verification_response(
            str(uuid.uuid4()),
            driver_id,
            session_id,
            result
        )
        
    except Exception as e:
        logger.error(f"Error in async verification: {e}")
        await redis_streams_manager.send_error_response(
            driver_id, session_id, str(e)
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

