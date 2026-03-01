"""
Anti-Spoofing Service for KYC Verification
Implements liveness detection to prevent fake face attacks
"""

import cv2
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
import logging
from dataclasses import dataclass
from enum import Enum
import time
from collections import deque

logger = logging.getLogger(__name__)

class LivenessStatus(Enum):
    """Liveness detection status"""
    PENDING = "pending"
    VERIFYING = "verifying"
    LIVE = "live"
    SPOOF = "spoof"
    TIMEOUT = "timeout"
    ERROR = "error"

@dataclass
class LivenessResult:
    """Liveness detection result"""
    status: LivenessStatus
    confidence: float
    method: str
    message: str
    metadata: Dict[str, Any]

class AntiSpoofingService:
    """Service for liveness detection and anti-spoofing"""
    
    def __init__(self):
        """Initialize anti-spoofing service"""
        self.face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        )
        
        # Initialize eye cascade for blink detection
        self.eye_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + 'haarcascade_eye.xml'
        )
        
        # Frame buffer for temporal analysis
        self.frame_buffer = deque(maxlen=30)  # 1 second at 30fps
        
        # Blink detection parameters
        self.blink_threshold = 0.25
        self.blink_frames = 0
        self.blink_detected = False
        
        # Motion detection parameters
        self.motion_threshold = 0.1
        self.motion_frames = deque(maxlen=10)
        
        logger.info("Anti-spoofing service initialized")
    
    def detect_liveness(self, frame: np.ndarray, method: str = "multi") -> LivenessResult:
        """
        Detect liveness using multiple methods
        
        Args:
            frame: Input frame
            method: Detection method ('blink', 'motion', 'emotion', 'multi')
            
        Returns:
            Liveness detection result
        """
        try:
            if method == "multi":
                return self._multi_method_detection(frame)
            elif method == "blink":
                return self._blink_detection(frame)
            elif method == "motion":
                return self._motion_detection(frame)
            elif method == "emotion":
                return self._emotion_detection(frame)
            else:
                return LivenessResult(
                    status=LivenessStatus.ERROR,
                    confidence=0.0,
                    method=method,
                    message="Unknown detection method",
                    metadata={}
                )
                
        except Exception as e:
            logger.error(f"Error in liveness detection: {e}")
            return LivenessResult(
                status=LivenessStatus.ERROR,
                confidence=0.0,
                method=method,
                message=f"Detection error: {str(e)}",
                metadata={}
            )
    
    def _multi_method_detection(self, frame: np.ndarray) -> LivenessResult:
        """Multi-method liveness detection"""
        try:
            # Add frame to buffer
            self.frame_buffer.append(frame.copy())
            
            if len(self.frame_buffer) < 10:
                return LivenessResult(
                    status=LivenessStatus.PENDING,
                    confidence=0.0,
                    method="multi",
                    message="Collecting frames for analysis",
                    metadata={"frames_collected": len(self.frame_buffer)}
                )
            
            # Run multiple detection methods
            blink_result = self._blink_detection(frame)
            motion_result = self._motion_detection(frame)
            emotion_result = self._emotion_detection(frame)
            
            # Combine results
            confidence_scores = []
            if blink_result.confidence > 0:
                confidence_scores.append(blink_result.confidence)
            if motion_result.confidence > 0:
                confidence_scores.append(motion_result.confidence)
            if emotion_result.confidence > 0:
                confidence_scores.append(emotion_result.confidence)
            
            if not confidence_scores:
                return LivenessResult(
                    status=LivenessStatus.SPOOF,
                    confidence=0.0,
                    method="multi",
                    message="No liveness indicators detected",
                    metadata={}
                )
            
            # Calculate combined confidence
            combined_confidence = np.mean(confidence_scores)
            
            # Determine status based on confidence
            if combined_confidence > 0.7:
                status = LivenessStatus.LIVE
                message = "Live person detected"
            elif combined_confidence > 0.4:
                status = LivenessStatus.VERIFYING
                message = "Verifying liveness"
            else:
                status = LivenessStatus.SPOOF
                message = "Potential spoof detected"
            
            return LivenessResult(
                status=status,
                confidence=combined_confidence,
                method="multi",
                message=message,
                metadata={
                    "blink_confidence": blink_result.confidence,
                    "motion_confidence": motion_result.confidence,
                    "emotion_confidence": emotion_result.confidence,
                    "methods_used": len(confidence_scores)
                }
            )
            
        except Exception as e:
            logger.error(f"Error in multi-method detection: {e}")
            return LivenessResult(
                status=LivenessStatus.ERROR,
                confidence=0.0,
                method="multi",
                message=f"Multi-method error: {str(e)}",
                metadata={}
            )
    
    def _blink_detection(self, frame: np.ndarray) -> LivenessResult:
        """Detect blinks for liveness verification"""
        try:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            
            # Detect faces
            faces = self.face_cascade.detectMultiScale(
                gray, 1.1, 4, minSize=(30, 30)
            )
            
            if len(faces) == 0:
                return LivenessResult(
                    status=LivenessStatus.SPOOF,
                    confidence=0.0,
                    method="blink",
                    message="No face detected",
                    metadata={}
                )
            
            # Process the largest face
            face = max(faces, key=lambda x: x[2] * x[3])
            x, y, w, h = face
            
            # Extract face region
            face_roi = gray[y:y+h, x:x+w]
            
            # Detect eyes
            eyes = self.eye_cascade.detectMultiScale(face_roi)
            
            if len(eyes) < 2:
                return LivenessResult(
                    status=LivenessStatus.SPOOF,
                    confidence=0.0,
                    method="blink",
                    message="Insufficient eyes detected",
                    metadata={"eyes_detected": len(eyes)}
                )
            
            # Calculate eye aspect ratio
            eye_ratio = self._calculate_eye_aspect_ratio(eyes)
            
            # Detect blink
            if eye_ratio < self.blink_threshold:
                self.blink_frames += 1
                if self.blink_frames >= 3:
                    self.blink_detected = True
            else:
                self.blink_frames = 0
            
            # Calculate confidence based on blink detection
            if self.blink_detected:
                confidence = 0.9
                status = LivenessStatus.LIVE
                message = "Blink detected - live person"
            else:
                confidence = 0.3
                status = LivenessStatus.VERIFYING
                message = "Waiting for blink detection"
            
            return LivenessResult(
                status=status,
                confidence=confidence,
                method="blink",
                message=message,
                metadata={
                    "eye_ratio": eye_ratio,
                    "blink_frames": self.blink_frames,
                    "blink_detected": self.blink_detected,
                    "eyes_detected": len(eyes)
                }
            )
            
        except Exception as e:
            logger.error(f"Error in blink detection: {e}")
            return LivenessResult(
                status=LivenessStatus.ERROR,
                confidence=0.0,
                method="blink",
                message=f"Blink detection error: {str(e)}",
                metadata={}
            )
    
    def _calculate_eye_aspect_ratio(self, eyes: List[Tuple[int, int, int, int]]) -> float:
        """Calculate eye aspect ratio for blink detection"""
        try:
            if len(eyes) < 2:
                return 1.0
            
            # Sort eyes by x-coordinate
            eyes = sorted(eyes, key=lambda x: x[0])
            
            # Calculate aspect ratio for both eyes
            ratios = []
            for eye in eyes:
                x, y, w, h = eye
                ratio = h / w
                ratios.append(ratio)
            
            return np.mean(ratios)
            
        except Exception:
            return 1.0
    
    def _motion_detection(self, frame: np.ndarray) -> LivenessResult:
        """Detect motion for liveness verification"""
        try:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            
            # Add frame to motion buffer
            self.motion_frames.append(gray.copy())
            
            if len(self.motion_frames) < 5:
                return LivenessResult(
                    status=LivenessStatus.PENDING,
                    confidence=0.0,
                    method="motion",
                    message="Collecting frames for motion analysis",
                    metadata={"frames_collected": len(self.motion_frames)}
                )
            
            # Calculate motion between consecutive frames
            motion_scores = []
            for i in range(1, len(self.motion_frames)):
                diff = cv2.absdiff(self.motion_frames[i-1], self.motion_frames[i])
                motion_score = np.mean(diff) / 255.0
                motion_scores.append(motion_score)
            
            avg_motion = np.mean(motion_scores)
            max_motion = np.max(motion_scores)
            
            # Determine confidence based on motion
            if avg_motion > self.motion_threshold:
                confidence = min(avg_motion * 2, 1.0)
                status = LivenessStatus.LIVE
                message = "Motion detected - live person"
            else:
                confidence = 0.2
                status = LivenessStatus.SPOOF
                message = "No significant motion detected"
            
            return LivenessResult(
                status=status,
                confidence=confidence,
                method="motion",
                message=message,
                metadata={
                    "avg_motion": avg_motion,
                    "max_motion": max_motion,
                    "motion_threshold": self.motion_threshold
                }
            )
            
        except Exception as e:
            logger.error(f"Error in motion detection: {e}")
            return LivenessResult(
                status=LivenessStatus.ERROR,
                confidence=0.0,
                method="motion",
                message=f"Motion detection error: {str(e)}",
                metadata={}
            )
    
    def _emotion_detection(self, frame: np.ndarray) -> LivenessResult:
        """Detect emotion changes for liveness verification"""
        try:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            
            # Detect faces
            faces = self.face_cascade.detectMultiScale(
                gray, 1.1, 4, minSize=(30, 30)
            )
            
            if len(faces) == 0:
                return LivenessResult(
                    status=LivenessStatus.SPOOF,
                    confidence=0.0,
                    method="emotion",
                    message="No face detected for emotion analysis",
                    metadata={}
                )
            
            # Process the largest face
            face = max(faces, key=lambda x: x[2] * x[3])
            x, y, w, h = face
            
            # Extract face region
            face_roi = gray[y:y+h, x:x+w]
            
            # Simple emotion detection based on facial features
            emotion_score = self._analyze_facial_features(face_roi)
            
            # Determine confidence based on emotion detection
            if emotion_score > 0.6:
                confidence = emotion_score
                status = LivenessStatus.LIVE
                message = "Facial expression detected - live person"
            else:
                confidence = 0.3
                status = LivenessStatus.VERIFYING
                message = "Analyzing facial expressions"
            
            return LivenessResult(
                status=status,
                confidence=confidence,
                method="emotion",
                message=message,
                metadata={
                    "emotion_score": emotion_score,
                    "face_size": w * h
                }
            )
            
        except Exception as e:
            logger.error(f"Error in emotion detection: {e}")
            return LivenessResult(
                status=LivenessStatus.ERROR,
                confidence=0.0,
                method="emotion",
                message=f"Emotion detection error: {str(e)}",
                metadata={}
            )
    
    def _analyze_facial_features(self, face_roi: np.ndarray) -> float:
        """Analyze facial features for emotion detection"""
        try:
            # Detect eyes and mouth regions
            eyes = self.eye_cascade.detectMultiScale(face_roi)
            
            # Simple feature analysis
            feature_score = 0.0
            
            # Eye detection score
            if len(eyes) >= 2:
                feature_score += 0.4
            
            # Face symmetry analysis
            h, w = face_roi.shape
            left_half = face_roi[:, :w//2]
            right_half = face_roi[:, w//2:]
            
            # Flip right half and compare
            right_half_flipped = cv2.flip(right_half, 1)
            
            # Resize to same dimensions
            min_width = min(left_half.shape[1], right_half_flipped.shape[1])
            left_half = left_half[:, :min_width]
            right_half_flipped = right_half_flipped[:, :min_width]
            
            # Calculate symmetry
            symmetry_diff = cv2.absdiff(left_half, right_half_flipped)
            symmetry_score = 1.0 - (np.mean(symmetry_diff) / 255.0)
            feature_score += symmetry_score * 0.3
            
            # Texture analysis
            texture_score = self._analyze_texture(face_roi)
            feature_score += texture_score * 0.3
            
            return min(feature_score, 1.0)
            
        except Exception:
            return 0.0
    
    def _analyze_texture(self, face_roi: np.ndarray) -> float:
        """Analyze texture for liveness detection"""
        try:
            # Calculate local binary pattern variance
            lbp = self._calculate_lbp(face_roi)
            texture_variance = np.var(lbp)
            
            # Normalize texture score
            texture_score = min(texture_variance / 1000.0, 1.0)
            
            return texture_score
            
        except Exception:
            return 0.0
    
    def _calculate_lbp(self, image: np.ndarray) -> np.ndarray:
        """Calculate Local Binary Pattern"""
        try:
            h, w = image.shape
            lbp = np.zeros((h-2, w-2), dtype=np.uint8)
            
            for i in range(1, h-1):
                for j in range(1, w-1):
                    center = image[i, j]
                    binary_string = ""
                    
                    # 8-neighborhood
                    neighbors = [
                        image[i-1, j-1], image[i-1, j], image[i-1, j+1],
                        image[i, j+1], image[i+1, j+1], image[i+1, j],
                        image[i+1, j-1], image[i, j-1]
                    ]
                    
                    for neighbor in neighbors:
                        binary_string += "1" if neighbor >= center else "0"
                    
                    lbp[i-1, j-1] = int(binary_string, 2)
            
            return lbp
            
        except Exception:
            return np.zeros((image.shape[0]-2, image.shape[1]-2), dtype=np.uint8)
    
    def reset_detection(self):
        """Reset detection state"""
        self.blink_frames = 0
        self.blink_detected = False
        self.frame_buffer.clear()
        self.motion_frames.clear()
        logger.info("Anti-spoofing detection reset")
    
    def cleanup(self):
        """Cleanup resources"""
        try:
            self.frame_buffer.clear()
            self.motion_frames.clear()
            logger.info("Anti-spoofing service cleaned up")
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")

