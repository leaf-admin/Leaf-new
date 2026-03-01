"""
Main KYC Service
Orchestrates face detection, anti-spoofing, and Redis Streams
"""

import asyncio
import logging
import signal
import sys
from typing import Dict, Any, Optional
import time
import uuid
import base64
import io
import numpy as np
import cv2
from PIL import Image

from .services.face_detection import FaceDetectionService, VerificationStatus
from .services.anti_spoofing import AntiSpoofingService, LivenessStatus
from .services.redis_streams import RedisStreamsManager, MessageType, KYCMessage
from .config.kyc_config import *

logger = logging.getLogger(__name__)

class KYCService:
    """Main KYC verification service"""
    
    def __init__(self):
        """Initialize KYC service"""
        self.face_detection_service = None
        self.anti_spoofing_service = None
        self.redis_streams_manager = None
        self.running = False
        self.verification_sessions = {}
        
        # Setup logging
        logging.basicConfig(
            level=getattr(logging, LOG_LEVEL),
            format=LOG_FORMAT,
            handlers=[
                logging.FileHandler(LOG_FILE),
                logging.StreamHandler(sys.stdout)
            ]
        )
        
        logger.info("KYC Service initialized")
    
    async def start(self):
        """Start the KYC service"""
        try:
            logger.info("Starting KYC service...")
            
            # Initialize services
            await self._initialize_services()
            
            # Start Redis Streams consumer
            await self._start_redis_consumer()
            
            self.running = True
            logger.info("KYC service started successfully")
            
            # Keep service running
            await self._keep_alive()
            
        except Exception as e:
            logger.error(f"Error starting KYC service: {e}")
            raise
    
    async def stop(self):
        """Stop the KYC service"""
        try:
            logger.info("Stopping KYC service...")
            self.running = False
            
            # Cleanup services
            await self._cleanup_services()
            
            logger.info("KYC service stopped")
            
        except Exception as e:
            logger.error(f"Error stopping KYC service: {e}")
    
    async def _initialize_services(self):
        """Initialize all services"""
        try:
            # Initialize face detection service
            self.face_detection_service = FaceDetectionService()
            logger.info("Face detection service initialized")
            
            # Initialize anti-spoofing service
            self.anti_spoofing_service = AntiSpoofingService()
            logger.info("Anti-spoofing service initialized")
            
            # Initialize Redis Streams manager
            redis_config = {
                "host": REDIS_HOST,
                "port": REDIS_PORT,
                "db": REDIS_DB,
                "password": REDIS_PASSWORD
            }
            self.redis_streams_manager = RedisStreamsManager(redis_config)
            await self.redis_streams_manager.connect()
            logger.info("Redis Streams manager initialized")
            
        except Exception as e:
            logger.error(f"Error initializing services: {e}")
            raise
    
    async def _start_redis_consumer(self):
        """Start Redis Streams consumer"""
        try:
            # Register message handler
            self.redis_streams_manager.register_message_handler(
                MessageType.VERIFICATION_REQUEST,
                self._handle_verification_request
            )
            
            # Start consumer in background
            asyncio.create_task(
                self.redis_streams_manager.consume_verification_requests(
                    self._handle_verification_request
                )
            )
            
            logger.info("Redis Streams consumer started")
            
        except Exception as e:
            logger.error(f"Error starting Redis consumer: {e}")
            raise
    
    async def _handle_verification_request(self, message: KYCMessage):
        """Handle verification request from Redis Streams"""
        try:
            logger.info(f"Processing verification request: {message.message_id}")
            
            # Extract data
            driver_id = message.driver_id
            session_id = message.session_id
            image_data = message.data.get("image_data")
            profile_image = message.data.get("profile_image")
            
            # Send status update
            await self.redis_streams_manager.send_status_update(
                driver_id, session_id, "processing", "Starting face verification"
            )
            
            # Decode images
            current_image = self._decode_base64_image(image_data)
            profile_image_array = self._decode_base64_image(profile_image)
            
            if current_image is None or profile_image_array is None:
                await self.redis_streams_manager.send_error_response(
                    driver_id, session_id, "Invalid image data"
                )
                return
            
            # Process verification
            result = await self._process_verification(
                driver_id, session_id, current_image, profile_image_array
            )
            
            # Send result
            await self.redis_streams_manager.send_verification_response(
                message.message_id, driver_id, session_id, result
            )
            
            logger.info(f"Verification completed for driver: {driver_id}")
            
        except Exception as e:
            logger.error(f"Error handling verification request: {e}")
            await self.redis_streams_manager.send_error_response(
                message.driver_id, message.session_id, str(e)
            )
    
    async def _process_verification(self, driver_id: str, session_id: str,
                                  current_image: np.ndarray, 
                                  profile_image: np.ndarray) -> Dict[str, Any]:
        """Process face verification"""
        try:
            # Detect faces in current image
            current_faces = self.face_detection_service.detect_faces(current_image)
            
            if not current_faces:
                return {
                    "status": "failed",
                    "confidence": 0.0,
                    "match_score": 0.0,
                    "quality_score": 0.0,
                    "liveness_score": 0.0,
                    "message": "No face detected in current image",
                    "error": "no_face_detected"
                }
            
            # Get the best quality face
            best_face = max(current_faces, key=lambda f: f.quality_score)
            
            # Extract face region
            x, y, w, h = best_face.bbox
            face_roi = current_image[y:y+h, x:x+w]
            
            # Send status update
            await self.redis_streams_manager.send_status_update(
                driver_id, session_id, "comparing", "Comparing faces"
            )
            
            # Compare faces
            match_score = self.face_detection_service.compare_faces(face_roi, profile_image)
            
            # Send status update
            await self.redis_streams_manager.send_status_update(
                driver_id, session_id, "liveness", "Checking liveness"
            )
            
            # Detect liveness
            liveness_result = self.anti_spoofing_service.detect_liveness(current_image)
            
            # Calculate overall confidence
            overall_confidence = (
                match_score * 0.4 +
                best_face.quality_score * 0.3 +
                liveness_result.confidence * 0.3
            )
            
            # Determine status
            if (match_score > 0.7 and 
                best_face.quality_score > 0.5 and 
                liveness_result.confidence > 0.6):
                status = "success"
                message = "Face verification successful"
            elif (match_score > 0.5 and 
                  best_face.quality_score > 0.3 and 
                  liveness_result.confidence > 0.4):
                status = "pending"
                message = "Verification in progress - please try again"
            else:
                status = "failed"
                message = "Face verification failed"
            
            # Send final status update
            await self.redis_streams_manager.send_status_update(
                driver_id, session_id, status, message
            )
            
            # Send analytics
            analytics_data = {
                "verification_time": time.time(),
                "face_count": len(current_faces),
                "match_score": match_score,
                "quality_score": best_face.quality_score,
                "liveness_score": liveness_result.confidence,
                "liveness_status": liveness_result.status.value,
                "liveness_method": liveness_result.method,
                "overall_confidence": overall_confidence,
                "status": status
            }
            
            await self.redis_streams_manager.send_analytics(
                driver_id, session_id, analytics_data
            )
            
            return {
                "status": status,
                "confidence": overall_confidence,
                "match_score": match_score,
                "quality_score": best_face.quality_score,
                "liveness_score": liveness_result.confidence,
                "message": message,
                "metadata": {
                    "face_count": len(current_faces),
                    "liveness_status": liveness_result.status.value,
                    "liveness_method": liveness_result.method,
                    "verification_time": time.time()
                }
            }
            
        except Exception as e:
            logger.error(f"Error processing verification: {e}")
            return {
                "status": "error",
                "confidence": 0.0,
                "match_score": 0.0,
                "quality_score": 0.0,
                "liveness_score": 0.0,
                "message": f"Verification error: {str(e)}",
                "error": str(e)
            }
    
    def _decode_base64_image(self, image_data: str) -> Optional[np.ndarray]:
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
    
    async def _keep_alive(self):
        """Keep service running"""
        try:
            while self.running:
                # Send heartbeat
                if self.redis_streams_manager:
                    await self.redis_streams_manager.send_analytics(
                        "system", "heartbeat", {
                            "status": "running",
                            "uptime": time.time(),
                            "active_sessions": len(self.verification_sessions)
                        }
                    )
                
                # Sleep for 30 seconds
                await asyncio.sleep(30)
                
        except Exception as e:
            logger.error(f"Error in keep alive: {e}")
    
    async def _cleanup_services(self):
        """Cleanup all services"""
        try:
            if self.face_detection_service:
                self.face_detection_service.cleanup()
            
            if self.anti_spoofing_service:
                self.anti_spoofing_service.cleanup()
            
            if self.redis_streams_manager:
                await self.redis_streams_manager.cleanup()
            
            logger.info("Services cleaned up")
            
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")

# Signal handlers
def signal_handler(signum, frame):
    """Handle shutdown signals"""
    logger.info(f"Received signal {signum}, shutting down...")
    sys.exit(0)

# Main function
async def main():
    """Main function"""
    # Setup signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Create and start service
    service = KYCService()
    
    try:
        await service.start()
    except KeyboardInterrupt:
        logger.info("Received keyboard interrupt")
    except Exception as e:
        logger.error(f"Service error: {e}")
    finally:
        await service.stop()

if __name__ == "__main__":
    asyncio.run(main())

