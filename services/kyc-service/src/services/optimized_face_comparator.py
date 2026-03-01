import cv2
import mediapipe as mp
import numpy as np
import json
from typing import Dict, Optional, Tuple
from .face_preprocessing import FacePreprocessor

class OptimizedFaceComparator:
    def __init__(self):
        """Inicializa o comparador otimizado de faces"""
        self.face_preprocessor = FacePreprocessor()
        
        # Configurações de comparação
        self.similarity_threshold = 0.85  # Threshold de similaridade
        self.feature_weights = {
            "eye_distance": 0.25,
            "nose_width": 0.20,
            "mouth_width": 0.20,
            "face_width": 0.15,
            "face_height": 0.10,
            "jaw_angle": 0.05,
            "eyebrow_angle": 0.05
        }
    
    def compare_with_stored_encodings(self, user_id: str, current_image_path: str) -> Dict:
        """Compara imagem atual com encodings armazenados"""
        try:
            # Buscar encodings armazenados
            stored_encodings = self.face_preprocessor.get_face_encodings(user_id)
            
            if not stored_encodings:
                return {
                    "success": False,
                    "error": "Encodings não encontrados para o usuário",
                    "user_id": user_id
                }
            
            # Extrair encodings da imagem atual
            current_encodings = self.face_preprocessor.extract_face_encodings(current_image_path)
            
            # Comparar características faciais
            similarity_score = self._calculate_similarity(
                stored_encodings["facial_features"],
                current_encodings["facial_features"]
            )
            
            # Verificar se é a mesma pessoa
            is_match = similarity_score >= self.similarity_threshold
            
            return {
                "success": True,
                "user_id": user_id,
                "is_match": is_match,
                "similarity_score": similarity_score,
                "threshold": self.similarity_threshold,
                "confidence": self._calculate_confidence(similarity_score),
                "comparison_details": {
                    "stored_features": stored_encodings["facial_features"],
                    "current_features": current_encodings["facial_features"],
                    "feature_differences": self._calculate_feature_differences(
                        stored_encodings["facial_features"],
                        current_encodings["facial_features"]
                    )
                }
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "user_id": user_id
            }
    
    def _calculate_similarity(self, stored_features: Dict, current_features: Dict) -> float:
        """Calcula similaridade entre características faciais"""
        try:
            total_similarity = 0.0
            total_weight = 0.0
            
            for feature_name, weight in self.feature_weights.items():
                if feature_name in stored_features and feature_name in current_features:
                    stored_value = stored_features[feature_name]
                    current_value = current_features[feature_name]
                    
                    # Calcular similaridade para esta característica
                    feature_similarity = self._calculate_feature_similarity(
                        stored_value, 
                        current_value, 
                        feature_name
                    )
                    
                    total_similarity += feature_similarity * weight
                    total_weight += weight
            
            return total_similarity / total_weight if total_weight > 0 else 0.0
            
        except Exception as e:
            print(f"Erro ao calcular similaridade: {str(e)}")
            return 0.0
    
    def _calculate_feature_similarity(self, stored_value: float, current_value: float, feature_name: str) -> float:
        """Calcula similaridade para uma característica específica"""
        try:
            # Evitar divisão por zero
            if stored_value == 0 and current_value == 0:
                return 1.0
            
            if stored_value == 0 or current_value == 0:
                return 0.0
            
            # Calcular diferença percentual
            difference = abs(stored_value - current_value)
            average_value = (stored_value + current_value) / 2
            
            # Normalizar diferença
            normalized_difference = difference / average_value
            
            # Converter para similaridade (0-1)
            similarity = max(0.0, 1.0 - normalized_difference)
            
            return similarity
            
        except Exception as e:
            print(f"Erro ao calcular similaridade da característica {feature_name}: {str(e)}")
            return 0.0
    
    def _calculate_feature_differences(self, stored_features: Dict, current_features: Dict) -> Dict:
        """Calcula diferenças detalhadas entre características"""
        differences = {}
        
        for feature_name in self.feature_weights.keys():
            if feature_name in stored_features and feature_name in current_features:
                stored_value = stored_features[feature_name]
                current_value = current_features[feature_name]
                
                difference = current_value - stored_value
                percent_difference = (difference / stored_value) * 100 if stored_value != 0 else 0
                
                differences[feature_name] = {
                    "stored": stored_value,
                    "current": current_value,
                    "difference": difference,
                    "percent_difference": percent_difference
                }
        
        return differences
    
    def _calculate_confidence(self, similarity_score: float) -> str:
        """Calcula nível de confiança baseado na similaridade"""
        if similarity_score >= 0.95:
            return "Muito Alta"
        elif similarity_score >= 0.90:
            return "Alta"
        elif similarity_score >= 0.85:
            return "Média"
        elif similarity_score >= 0.75:
            return "Baixa"
        else:
            return "Muito Baixa"
    
    def batch_compare(self, user_ids: list, current_image_path: str) -> Dict:
        """Compara uma imagem com múltiplos usuários"""
        results = {}
        
        for user_id in user_ids:
            result = self.compare_with_stored_encodings(user_id, current_image_path)
            results[user_id] = result
        
        # Encontrar melhor match
        best_match = None
        best_score = 0.0
        
        for user_id, result in results.items():
            if result["success"] and result["similarity_score"] > best_score:
                best_score = result["similarity_score"]
                best_match = user_id
        
        return {
            "results": results,
            "best_match": best_match,
            "best_score": best_score,
            "total_compared": len(user_ids)
        }
    
    def update_similarity_threshold(self, new_threshold: float) -> bool:
        """Atualiza threshold de similaridade"""
        try:
            if 0.0 <= new_threshold <= 1.0:
                self.similarity_threshold = new_threshold
                return True
            return False
        except Exception as e:
            print(f"Erro ao atualizar threshold: {str(e)}")
            return False
    
    def get_comparison_stats(self) -> Dict:
        """Retorna estatísticas de comparação"""
        return {
            "similarity_threshold": self.similarity_threshold,
            "feature_weights": self.feature_weights,
            "total_features": len(self.feature_weights),
            "preprocessor_stats": self.face_preprocessor.get_encoding_stats()
        }

