import cv2
import mediapipe as mp
import numpy as np
import json
import redis
import time
from typing import List, Dict, Optional
from config.kyc_config import REDIS_HOST, REDIS_PORT, REDIS_DB, REDIS_PASSWORD

class FacePreprocessor:
    def __init__(self):
        """Inicializa o pré-processador de faces"""
        self.mp_face_detection = mp.solutions.face_detection
        self.mp_face_mesh = mp.solutions.face_mesh
        self.mp_drawing = mp.solutions.drawing_utils
        
        # Configuração Redis
        self.redis_client = redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            db=REDIS_DB,
            password=REDIS_PASSWORD,
            decode_responses=True
        )
        
        # Configurações de detecção
        self.face_detection = self.mp_face_detection.FaceDetection(
            model_selection=1,  # Modelo mais preciso
            min_detection_confidence=0.7
        )
        
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.7,
            min_tracking_confidence=0.7
        )
    
    def extract_face_encodings(self, image_path: str) -> Dict:
        """Extrai encodings faciais de uma imagem de perfil"""
        try:
            # Carregar imagem
            image = cv2.imread(image_path)
            if image is None:
                raise ValueError(f"Não foi possível carregar a imagem: {image_path}")
            
            # Converter para RGB
            rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            
            # Detectar faces
            face_detection_results = self.face_detection.process(rgb_image)
            
            if not face_detection_results.detections:
                raise ValueError("Nenhuma face detectada na imagem")
            
            # Processar primeira face detectada
            face_detection = face_detection_results.detections[0]
            
            # Extrair landmarks faciais
            face_mesh_results = self.face_mesh.process(rgb_image)
            
            if not face_mesh_results.multi_face_landmarks:
                raise ValueError("Não foi possível extrair landmarks faciais")
            
            face_landmarks = face_mesh_results.multi_face_landmarks[0]
            
            # Extrair características faciais
            encodings = self._extract_facial_features(rgb_image, face_landmarks, face_detection)
            
            return {
                "face_detection": {
                    "confidence": face_detection.score[0],
                    "bbox": [
                        face_detection.location_data.relative_bounding_box.xmin,
                        face_detection.location_data.relative_bounding_box.ymin,
                        face_detection.location_data.relative_bounding_box.width,
                        face_detection.location_data.relative_bounding_box.height
                    ]
                },
                "face_landmarks": self._landmarks_to_dict(face_landmarks),
                "facial_features": encodings,
                "image_metadata": {
                    "width": image.shape[1],
                    "height": image.shape[0],
                    "channels": image.shape[2]
                }
            }
            
        except Exception as e:
            raise Exception(f"Erro ao extrair encodings faciais: {str(e)}")
    
    def _extract_facial_features(self, image: np.ndarray, landmarks, detection) -> Dict:
        """Extrai características faciais específicas"""
        h, w, _ = image.shape
        
        # Converter landmarks para coordenadas de pixel
        landmark_points = []
        for landmark in landmarks.landmark:
            x = int(landmark.x * w)
            y = int(landmark.y * h)
            landmark_points.append([x, y])
        
        landmark_points = np.array(landmark_points)
        
        # Extrair características específicas
        features = {
            "eye_distance": self._calculate_eye_distance(landmark_points),
            "nose_width": self._calculate_nose_width(landmark_points),
            "mouth_width": self._calculate_mouth_width(landmark_points),
            "face_width": self._calculate_face_width(landmark_points),
            "face_height": self._calculate_face_height(landmark_points),
            "jaw_angle": self._calculate_jaw_angle(landmark_points),
            "eyebrow_angle": self._calculate_eyebrow_angle(landmark_points)
        }
        
        return features
    
    def _calculate_eye_distance(self, landmarks: np.ndarray) -> float:
        """Calcula distância entre os olhos"""
        # Pontos dos olhos (aproximados)
        left_eye = landmarks[33]  # Ponto central do olho esquerdo
        right_eye = landmarks[362]  # Ponto central do olho direito
        return np.linalg.norm(left_eye - right_eye)
    
    def _calculate_nose_width(self, landmarks: np.ndarray) -> float:
        """Calcula largura do nariz"""
        nose_left = landmarks[31]
        nose_right = landmarks[35]
        return np.linalg.norm(nose_left - nose_right)
    
    def _calculate_mouth_width(self, landmarks: np.ndarray) -> float:
        """Calcula largura da boca"""
        mouth_left = landmarks[61]
        mouth_right = landmarks[291]
        return np.linalg.norm(mouth_left - mouth_right)
    
    def _calculate_face_width(self, landmarks: np.ndarray) -> float:
        """Calcula largura do rosto"""
        face_left = landmarks[234]
        face_right = landmarks[454]
        return np.linalg.norm(face_left - face_right)
    
    def _calculate_face_height(self, landmarks: np.ndarray) -> float:
        """Calcula altura do rosto"""
        face_top = landmarks[10]
        face_bottom = landmarks[152]
        return np.linalg.norm(face_top - face_bottom)
    
    def _calculate_jaw_angle(self, landmarks: np.ndarray) -> float:
        """Calcula ângulo da mandíbula"""
        jaw_left = landmarks[172]
        jaw_right = landmarks[397]
        jaw_center = landmarks[18]
        
        # Calcular ângulo
        v1 = jaw_left - jaw_center
        v2 = jaw_right - jaw_center
        angle = np.arccos(np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2)))
        return np.degrees(angle)
    
    def _calculate_eyebrow_angle(self, landmarks: np.ndarray) -> float:
        """Calcula ângulo das sobrancelhas"""
        eyebrow_left = landmarks[70]
        eyebrow_right = landmarks[300]
        eyebrow_center = landmarks[9]
        
        # Calcular ângulo
        v1 = eyebrow_left - eyebrow_center
        v2 = eyebrow_right - eyebrow_center
        angle = np.arccos(np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2)))
        return np.degrees(angle)
    
    def _landmarks_to_dict(self, landmarks) -> List[Dict]:
        """Converte landmarks para dicionário"""
        landmark_dict = []
        for i, landmark in enumerate(landmarks.landmark):
            landmark_dict.append({
                "x": landmark.x,
                "y": landmark.y,
                "z": landmark.z,
                "index": i
            })
        return landmark_dict
    
    def preprocess_profile_image(self, user_id: str, image_path: str) -> Dict:
        """Pré-processa imagem de perfil e salva encodings no Redis"""
        try:
            # Extrair encodings
            encodings = self.extract_face_encodings(image_path)
            
            # Salvar no Redis com TTL de 24 horas
            redis_key = f"face_encodings:{user_id}"
            self.redis_client.setex(
                redis_key, 
                86400,  # 24 horas
                json.dumps(encodings)
            )
            
            # Salvar metadados
            metadata_key = f"face_metadata:{user_id}"
            metadata = {
                "user_id": user_id,
                "processed_at": int(time.time()),
                "image_path": image_path,
                "encoding_count": len(encodings["facial_features"])
            }
            
            self.redis_client.setex(
                metadata_key,
                86400,
                json.dumps(metadata)
            )
            
            return {
                "success": True,
                "user_id": user_id,
                "encodings_saved": True,
                "redis_key": redis_key,
                "metadata": metadata
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "user_id": user_id
            }
    
    def get_face_encodings(self, user_id: str) -> Optional[Dict]:
        """Recupera encodings faciais do Redis"""
        try:
            redis_key = f"face_encodings:{user_id}"
            encodings_data = self.redis_client.get(redis_key)
            
            if encodings_data:
                return json.loads(encodings_data)
            return None
            
        except Exception as e:
            print(f"Erro ao recuperar encodings para {user_id}: {str(e)}")
            return None
    
    def delete_face_encodings(self, user_id: str) -> bool:
        """Remove encodings faciais do Redis"""
        try:
            redis_key = f"face_encodings:{user_id}"
            metadata_key = f"face_metadata:{user_id}"
            
            self.redis_client.delete(redis_key)
            self.redis_client.delete(metadata_key)
            
            return True
            
        except Exception as e:
            print(f"Erro ao deletar encodings para {user_id}: {str(e)}")
            return False
    
    def get_encoding_stats(self) -> Dict:
        """Retorna estatísticas dos encodings armazenados"""
        try:
            # Buscar todas as chaves de encodings
            encoding_keys = self.redis_client.keys("face_encodings:*")
            metadata_keys = self.redis_client.keys("face_metadata:*")
            
            return {
                "total_encodings": len(encoding_keys),
                "total_metadata": len(metadata_keys),
                "encoding_keys": encoding_keys,
                "metadata_keys": metadata_keys
            }
            
        except Exception as e:
            return {
                "error": str(e),
                "total_encodings": 0,
                "total_metadata": 0
            }

