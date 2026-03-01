"""
Face Detection Service using OpenCV and MediaPipe
Handles real-time face detection and verification
"""

import cv2
import numpy as np
import mediapipe as mp
from typing import List, Tuple, Optional, Dict, Any
import logging
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)

class VerificationStatus(Enum):
    """Status of face verification"""
    PENDING = "pending"
    VERIFYING = "verifying"
    SUCCESS = "success"
    FAILED = "failed"
    TIMEOUT = "timeout"

@dataclass
class FaceDetection:
    """Face detection result"""
    bbox: Tuple[int, int, int, int]  # x, y, width, height
    confidence: float
    landmarks: List[Tuple[int, int]]
    quality_score: float

@dataclass
class VerificationResult:
    """Face verification result"""
    status: VerificationStatus
    confidence: float
    match_score: float
    quality_score: float
    message: str
    metadata: Dict[str, Any]

class FaceDetectionService:
    """Service for face detection and verification"""
    
    def __init__(self):
        """Initialize face detection service"""
        self.mp_face_detection = mp.solutions.face_detection
        self.mp_face_mesh = mp.solutions.face_mesh
        self.mp_drawing = mp.solutions.drawing_utils
        
        # Initialize MediaPipe face detection
        self.face_detection = self.mp_face_detection.FaceDetection(
            model_selection=1,  # 0 for close-range, 1 for full-range
            min_detection_confidence=0.5
        )
        
        # Initialize MediaPipe face mesh for landmarks
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            static_image_mode=False,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        
        # Initialize OpenCV face cascade
        self.face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        )
        
        logger.info("Face detection service initialized")
    
    def detect_faces(self, image: np.ndarray) -> List[FaceDetection]:
        """
        Detect faces in image using multiple methods
        
        Args:
            image: Input image as numpy array
            
        Returns:
            List of detected faces
        """
        faces = []
        
        try:
            # Convert BGR to RGB for MediaPipe
            rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            
            # MediaPipe face detection
            mp_results = self.face_detection.process(rgb_image)
            
            if mp_results.detections:
                for detection in mp_results.detections:
                    bbox = detection.location_data.relative_bounding_box
                    h, w, _ = image.shape
                    
                    x = int(bbox.xmin * w)
                    y = int(bbox.ymin * h)
                    width = int(bbox.width * w)
                    height = int(bbox.height * h)
                    
                    # Calculate quality score
                    quality_score = self._calculate_face_quality(
                        image[y:y+height, x:x+width]
                    )
                    
                    # Get facial landmarks
                    landmarks = self._get_facial_landmarks(
                        rgb_image[y:y+height, x:x+width]
                    )
                    
                    face = FaceDetection(
                        bbox=(x, y, width, height),
                        confidence=detection.score[0],
                        landmarks=landmarks,
                        quality_score=quality_score
                    )
                    faces.append(face)
            
            # Fallback to OpenCV if no faces detected
            if not faces:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
                cv_faces = self.face_cascade.detectMultiScale(
                    gray, 1.1, 4, minSize=(30, 30)
                )
                
                for (x, y, w, h) in cv_faces:
                    quality_score = self._calculate_face_quality(
                        image[y:y+h, x:x+w]
                    )
                    
                    face = FaceDetection(
                        bbox=(x, y, w, h),
                        confidence=0.8,  # Default confidence for OpenCV
                        landmarks=[],
                        quality_score=quality_score
                    )
                    faces.append(face)
            
            logger.info(f"Detected {len(faces)} faces")
            return faces
            
        except Exception as e:
            logger.error(f"Error detecting faces: {e}")
            return []
    
    def _calculate_face_quality(self, face_roi: np.ndarray) -> float:
        """
        Calculate face quality score based on various factors
        
        Args:
            face_roi: Face region of interest
            
        Returns:
            Quality score between 0 and 1
        """
        try:
            if face_roi.size == 0:
                return 0.0
            
            # Convert to grayscale
            gray = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY)
            
            # Calculate sharpness using Laplacian variance
            laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
            sharpness_score = min(laplacian_var / 1000.0, 1.0)
            
            # Calculate brightness
            mean_brightness = np.mean(gray)
            brightness_score = 1.0 - abs(mean_brightness - 127.5) / 127.5
            
            # Calculate contrast
            contrast_score = np.std(gray) / 128.0
            contrast_score = min(contrast_score, 1.0)
            
            # Calculate size score (prefer larger faces)
            height, width = gray.shape
            size_score = min((height * width) / (100 * 100), 1.0)
            
            # Weighted combination
            quality_score = (
                0.3 * sharpness_score +
                0.2 * brightness_score +
                0.2 * contrast_score +
                0.3 * size_score
            )
            
            return min(quality_score, 1.0)
            
        except Exception as e:
            logger.error(f"Error calculating face quality: {e}")
            return 0.0
    
    def _get_facial_landmarks(self, face_roi: np.ndarray) -> List[Tuple[int, int]]:
        """
        Get facial landmarks using MediaPipe
        
        Args:
            face_roi: Face region of interest
            
        Returns:
            List of landmark coordinates
        """
        try:
            results = self.face_mesh.process(face_roi)
            landmarks = []
            
            if results.multi_face_landmarks:
                for face_landmarks in results.multi_face_landmarks:
                    h, w, _ = face_roi.shape
                    for landmark in face_landmarks.landmark:
                        x = int(landmark.x * w)
                        y = int(landmark.y * h)
                        landmarks.append((x, y))
            
            return landmarks
            
        except Exception as e:
            logger.error(f"Error getting facial landmarks: {e}")
            return []
    
    def compare_faces(self, face1: np.ndarray, face2: np.ndarray) -> float:
        """
        Compare two face images and return similarity score
        
        Args:
            face1: First face image
            face2: Second face image
            
        Returns:
            Similarity score between 0 and 1
        """
        try:
            # Resize faces to same size
            face1_resized = cv2.resize(face1, (128, 128))
            face2_resized = cv2.resize(face2, (128, 128))
            
            # Convert to grayscale
            gray1 = cv2.cvtColor(face1_resized, cv2.COLOR_BGR2GRAY)
            gray2 = cv2.cvtColor(face2_resized, cv2.COLOR_BGR2GRAY)
            
            # Calculate structural similarity
            similarity = self._calculate_structural_similarity(gray1, gray2)
            
            # Calculate histogram similarity
            hist_similarity = self._calculate_histogram_similarity(gray1, gray2)
            
            # Calculate feature similarity using ORB
            feature_similarity = self._calculate_feature_similarity(gray1, gray2)
            
            # Weighted combination
            match_score = (
                0.4 * similarity +
                0.3 * hist_similarity +
                0.3 * feature_similarity
            )
            
            return min(match_score, 1.0)
            
        except Exception as e:
            logger.error(f"Error comparing faces: {e}")
            return 0.0
    
    def _calculate_structural_similarity(self, img1: np.ndarray, img2: np.ndarray) -> float:
        """Calculate structural similarity between two images"""
        try:
            # Simple SSIM implementation
            mu1 = np.mean(img1)
            mu2 = np.mean(img2)
            
            sigma1 = np.var(img1)
            sigma2 = np.var(img2)
            sigma12 = np.mean((img1 - mu1) * (img2 - mu2))
            
            c1 = 0.01 ** 2
            c2 = 0.03 ** 2
            
            ssim = ((2 * mu1 * mu2 + c1) * (2 * sigma12 + c2)) / \
                   ((mu1 ** 2 + mu2 ** 2 + c1) * (sigma1 + sigma2 + c2))
            
            return max(0, ssim)
            
        except Exception:
            return 0.0
    
    def _calculate_histogram_similarity(self, img1: np.ndarray, img2: np.ndarray) -> float:
        """Calculate histogram similarity between two images"""
        try:
            hist1 = cv2.calcHist([img1], [0], None, [256], [0, 256])
            hist2 = cv2.calcHist([img2], [0], None, [256], [0, 256])
            
            correlation = cv2.compareHist(hist1, hist2, cv2.HISTCMP_CORREL)
            return max(0, correlation)
            
        except Exception:
            return 0.0
    
    def _calculate_feature_similarity(self, img1: np.ndarray, img2: np.ndarray) -> float:
        """Calculate feature similarity using ORB"""
        try:
            orb = cv2.ORB_create()
            kp1, des1 = orb.detectAndCompute(img1, None)
            kp2, des2 = orb.detectAndCompute(img2, None)
            
            if des1 is None or des2 is None:
                return 0.0
            
            bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
            matches = bf.match(des1, des2)
            matches = sorted(matches, key=lambda x: x.distance)
            
            if len(matches) == 0:
                return 0.0
            
            # Calculate similarity based on match quality
            good_matches = [m for m in matches if m.distance < 50]
            similarity = len(good_matches) / max(len(kp1), len(kp2))
            
            return min(similarity, 1.0)
            
        except Exception:
            return 0.0
    
    def detect_emotion_change(self, face_roi: np.ndarray) -> Dict[str, float]:
        """
        Detect emotion changes in face (for anti-spoofing)
        
        Args:
            face_roi: Face region of interest
            
        Returns:
            Dictionary with emotion scores
        """
        try:
            # Simple emotion detection based on facial landmarks
            results = self.face_mesh.process(face_roi)
            emotions = {
                'smile': 0.0,
                'frown': 0.0,
                'surprise': 0.0,
                'neutral': 1.0
            }
            
            if results.multi_face_landmarks:
                for face_landmarks in results.multi_face_landmarks:
                    # Calculate mouth curvature for smile detection
                    mouth_points = []
                    for i in range(61, 68):  # Mouth landmarks
                        landmark = face_landmarks.landmark[i]
                        mouth_points.append((landmark.x, landmark.y))
                    
                    if len(mouth_points) >= 7:
                        # Simple smile detection
                        mouth_center_y = np.mean([p[1] for p in mouth_points])
                        mouth_corners_y = (mouth_points[0][1] + mouth_points[6][1]) / 2
                        
                        if mouth_center_y > mouth_corners_y:
                            emotions['smile'] = 0.8
                            emotions['neutral'] = 0.2
            
            return emotions
            
        except Exception as e:
            logger.error(f"Error detecting emotion change: {e}")
            return {'neutral': 1.0}
    
    def cleanup(self):
        """Cleanup resources"""
        try:
            self.face_detection.close()
            self.face_mesh.close()
            logger.info("Face detection service cleaned up")
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")

