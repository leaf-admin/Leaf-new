"""
Redis Streams Integration for KYC Service
Handles communication between mobile app and KYC service
"""

import redis
import json
import asyncio
import logging
from typing import Dict, Any, Optional, List, Callable
from dataclasses import dataclass, asdict
from enum import Enum
import uuid
import time
from datetime import datetime

logger = logging.getLogger(__name__)

class MessageType(Enum):
    """Message types for Redis Streams"""
    VERIFICATION_REQUEST = "verification_request"
    VERIFICATION_RESPONSE = "verification_response"
    STATUS_UPDATE = "status_update"
    ERROR = "error"
    HEARTBEAT = "heartbeat"

@dataclass
class KYCMessage:
    """KYC message structure"""
    message_id: str
    message_type: MessageType
    driver_id: str
    session_id: str
    timestamp: float
    data: Dict[str, Any]
    metadata: Dict[str, Any]

class RedisStreamManager:
    """Manager for Redis Streams communication"""
    
    def __init__(self, redis_config: Dict[str, Any]):
        """Initialize Redis Streams manager"""
        self.redis_config = redis_config
        self.redis_client = None
        self.consumer_group = "kyc_verification_group"
        self.consumer_name = f"kyc_worker_{uuid.uuid4().hex[:8]}"
        
        # Stream names
        self.verification_stream = "kyc:verification"
        self.results_stream = "kyc:results"
        self.analytics_stream = "kyc:analytics"
        
        # Message handlers
        self.message_handlers: Dict[MessageType, Callable] = {}
        
        logger.info(f"Redis Streams manager initialized with consumer: {self.consumer_name}")
    
    async def connect(self):
        """Connect to Redis"""
        try:
            self.redis_client = redis.Redis(
                host=self.redis_config.get('host', 'localhost'),
                port=self.redis_config.get('port', 6379),
                db=self.redis_config.get('db', 0),
                password=self.redis_config.get('password'),
                decode_responses=True
            )
            
            # Test connection
            await self.redis_client.ping()
            
            # Create consumer groups
            await self._create_consumer_groups()
            
            logger.info("Connected to Redis successfully")
            
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            raise
    
    async def _create_consumer_groups(self):
        """Create consumer groups for streams"""
        try:
            streams = [
                self.verification_stream,
                self.results_stream,
                self.analytics_stream
            ]
            
            for stream in streams:
                try:
                    # Create consumer group
                    await self.redis_client.xgroup_create(
                        stream, self.consumer_group, id='0', mkstream=True
                    )
                    logger.info(f"Created consumer group for stream: {stream}")
                except redis.RedisError as e:
                    if "BUSYGROUP" in str(e):
                        logger.info(f"Consumer group already exists for stream: {stream}")
                    else:
                        logger.error(f"Error creating consumer group for {stream}: {e}")
                        
        except Exception as e:
            logger.error(f"Error creating consumer groups: {e}")
    
    async def send_verification_request(self, driver_id: str, session_id: str, 
                                     image_data: str, profile_image: str) -> str:
        """
        Send verification request to stream
        
        Args:
            driver_id: Driver ID
            session_id: Session ID
            image_data: Base64 encoded image data
            profile_image: Base64 encoded profile image
            
        Returns:
            Message ID
        """
        try:
            message_id = str(uuid.uuid4())
            
            message = KYCMessage(
                message_id=message_id,
                message_type=MessageType.VERIFICATION_REQUEST,
                driver_id=driver_id,
                session_id=session_id,
                timestamp=time.time(),
                data={
                    "image_data": image_data,
                    "profile_image": profile_image,
                    "request_type": "face_verification"
                },
                metadata={
                    "source": "mobile_app",
                    "version": "1.0",
                    "timestamp": datetime.now().isoformat()
                }
            )
            
            # Send to verification stream
            await self.redis_client.xadd(
                self.verification_stream,
                {
                    "message_id": message_id,
                    "message_type": message.message_type.value,
                    "driver_id": driver_id,
                    "session_id": session_id,
                    "timestamp": str(message.timestamp),
                    "data": json.dumps(message.data),
                    "metadata": json.dumps(message.metadata)
                }
            )
            
            logger.info(f"Sent verification request: {message_id}")
            return message_id
            
        except Exception as e:
            logger.error(f"Error sending verification request: {e}")
            raise
    
    async def send_verification_response(self, message_id: str, driver_id: str, 
                                       session_id: str, result: Dict[str, Any]) -> str:
        """
        Send verification response to stream
        
        Args:
            message_id: Original message ID
            driver_id: Driver ID
            session_id: Session ID
            result: Verification result
            
        Returns:
            Response message ID
        """
        try:
            response_id = str(uuid.uuid4())
            
            message = KYCMessage(
                message_id=response_id,
                message_type=MessageType.VERIFICATION_RESPONSE,
                driver_id=driver_id,
                session_id=session_id,
                timestamp=time.time(),
                data=result,
                metadata={
                    "original_message_id": message_id,
                    "source": "kyc_service",
                    "version": "1.0",
                    "timestamp": datetime.now().isoformat()
                }
            )
            
            # Send to results stream
            await self.redis_client.xadd(
                self.results_stream,
                {
                    "message_id": response_id,
                    "message_type": message.message_type.value,
                    "driver_id": driver_id,
                    "session_id": session_id,
                    "timestamp": str(message.timestamp),
                    "data": json.dumps(message.data),
                    "metadata": json.dumps(message.metadata)
                }
            )
            
            logger.info(f"Sent verification response: {response_id}")
            return response_id
            
        except Exception as e:
            logger.error(f"Error sending verification response: {e}")
            raise
    
    async def send_status_update(self, driver_id: str, session_id: str, 
                               status: str, message: str) -> str:
        """
        Send status update to stream
        
        Args:
            driver_id: Driver ID
            session_id: Session ID
            status: Status update
            message: Status message
            
        Returns:
            Message ID
        """
        try:
            message_id = str(uuid.uuid4())
            
            update_message = KYCMessage(
                message_id=message_id,
                message_type=MessageType.STATUS_UPDATE,
                driver_id=driver_id,
                session_id=session_id,
                timestamp=time.time(),
                data={
                    "status": status,
                    "message": message
                },
                metadata={
                    "source": "kyc_service",
                    "version": "1.0",
                    "timestamp": datetime.now().isoformat()
                }
            )
            
            # Send to results stream
            await self.redis_client.xadd(
                self.results_stream,
                {
                    "message_id": message_id,
                    "message_type": update_message.message_type.value,
                    "driver_id": driver_id,
                    "session_id": session_id,
                    "timestamp": str(update_message.timestamp),
                    "data": json.dumps(update_message.data),
                    "metadata": json.dumps(update_message.metadata)
                }
            )
            
            logger.info(f"Sent status update: {message_id}")
            return message_id
            
        except Exception as e:
            logger.error(f"Error sending status update: {e}")
            raise
    
    async def consume_verification_requests(self, handler: Callable):
        """
        Consume verification requests from stream
        
        Args:
            handler: Function to handle verification requests
        """
        try:
            logger.info("Starting verification request consumer")
            
            while True:
                try:
                    # Read from stream
                    messages = await self.redis_client.xreadgroup(
                        self.consumer_group,
                        self.consumer_name,
                        {self.verification_stream: '>'},
                        count=1,
                        block=1000
                    )
                    
                    if messages:
                        for stream, msgs in messages:
                            for msg_id, fields in msgs:
                                try:
                                    # Parse message
                                    message = self._parse_message(msg_id, fields)
                                    
                                    # Handle message
                                    await handler(message)
                                    
                                    # Acknowledge message
                                    await self.redis_client.xack(
                                        self.verification_stream,
                                        self.consumer_group,
                                        msg_id
                                    )
                                    
                                except Exception as e:
                                    logger.error(f"Error processing message {msg_id}: {e}")
                                    
                                    # Send error response
                                    await self.send_error_response(
                                        fields.get('driver_id', 'unknown'),
                                        fields.get('session_id', 'unknown'),
                                        str(e)
                                    )
                
                except redis.RedisError as e:
                    logger.error(f"Redis error in consumer: {e}")
                    await asyncio.sleep(1)
                
                except Exception as e:
                    logger.error(f"Error in consumer loop: {e}")
                    await asyncio.sleep(1)
                    
        except Exception as e:
            logger.error(f"Error in verification request consumer: {e}")
            raise
    
    async def consume_status_updates(self, driver_id: str, session_id: str, 
                                   timeout: int = 30) -> List[KYCMessage]:
        """
        Consume status updates for specific driver/session
        
        Args:
            driver_id: Driver ID
            session_id: Session ID
            timeout: Timeout in seconds
            
        Returns:
            List of status update messages
        """
        try:
            updates = []
            start_time = time.time()
            
            while time.time() - start_time < timeout:
                try:
                    # Read from results stream
                    messages = await self.redis_client.xread(
                        {self.results_stream: '0'},
                        count=10,
                        block=1000
                    )
                    
                    if messages:
                        for stream, msgs in messages:
                            for msg_id, fields in msgs:
                                message = self._parse_message(msg_id, fields)
                                
                                # Filter by driver_id and session_id
                                if (message.driver_id == driver_id and 
                                    message.session_id == session_id):
                                    updates.append(message)
                    
                    # Check if we have enough updates
                    if len(updates) >= 5:  # Adjust as needed
                        break
                        
                except Exception as e:
                    logger.error(f"Error consuming status updates: {e}")
                    break
            
            return updates
            
        except Exception as e:
            logger.error(f"Error consuming status updates: {e}")
            return []
    
    def _parse_message(self, msg_id: str, fields: Dict[str, str]) -> KYCMessage:
        """Parse Redis message to KYCMessage"""
        try:
            return KYCMessage(
                message_id=msg_id,
                message_type=MessageType(fields.get('message_type', 'error')),
                driver_id=fields.get('driver_id', ''),
                session_id=fields.get('session_id', ''),
                timestamp=float(fields.get('timestamp', 0)),
                data=json.loads(fields.get('data', '{}')),
                metadata=json.loads(fields.get('metadata', '{}'))
            )
        except Exception as e:
            logger.error(f"Error parsing message: {e}")
            raise
    
    async def send_error_response(self, driver_id: str, session_id: str, 
                                error_message: str) -> str:
        """
        Send error response to stream
        
        Args:
            driver_id: Driver ID
            session_id: Session ID
            error_message: Error message
            
        Returns:
            Message ID
        """
        try:
            message_id = str(uuid.uuid4())
            
            error_message_obj = KYCMessage(
                message_id=message_id,
                message_type=MessageType.ERROR,
                driver_id=driver_id,
                session_id=session_id,
                timestamp=time.time(),
                data={
                    "error": error_message,
                    "status": "error"
                },
                metadata={
                    "source": "kyc_service",
                    "version": "1.0",
                    "timestamp": datetime.now().isoformat()
                }
            )
            
            # Send to results stream
            await self.redis_client.xadd(
                self.results_stream,
                {
                    "message_id": message_id,
                    "message_type": error_message_obj.message_type.value,
                    "driver_id": driver_id,
                    "session_id": session_id,
                    "timestamp": str(error_message_obj.timestamp),
                    "data": json.dumps(error_message_obj.data),
                    "metadata": json.dumps(error_message_obj.metadata)
                }
            )
            
            logger.info(f"Sent error response: {message_id}")
            return message_id
            
        except Exception as e:
            logger.error(f"Error sending error response: {e}")
            raise
    
    async def send_analytics(self, driver_id: str, session_id: str, 
                           analytics_data: Dict[str, Any]) -> str:
        """
        Send analytics data to stream
        
        Args:
            driver_id: Driver ID
            session_id: Session ID
            analytics_data: Analytics data
            
        Returns:
            Message ID
        """
        try:
            message_id = str(uuid.uuid4())
            
            analytics_message = KYCMessage(
                message_id=message_id,
                message_type=MessageType.STATUS_UPDATE,
                driver_id=driver_id,
                session_id=session_id,
                timestamp=time.time(),
                data=analytics_data,
                metadata={
                    "source": "kyc_service",
                    "type": "analytics",
                    "version": "1.0",
                    "timestamp": datetime.now().isoformat()
                }
            )
            
            # Send to analytics stream
            await self.redis_client.xadd(
                self.analytics_stream,
                {
                    "message_id": message_id,
                    "message_type": analytics_message.message_type.value,
                    "driver_id": driver_id,
                    "session_id": session_id,
                    "timestamp": str(analytics_message.timestamp),
                    "data": json.dumps(analytics_message.data),
                    "metadata": json.dumps(analytics_message.metadata)
                }
            )
            
            logger.info(f"Sent analytics data: {message_id}")
            return message_id
            
        except Exception as e:
            logger.error(f"Error sending analytics: {e}")
            raise
    
    async def disconnect(self):
        """Disconnect from Redis"""
        try:
            if self.redis_client:
                await self.redis_client.close()
                logger.info("Disconnected from Redis")
        except Exception as e:
            logger.error(f"Error disconnecting from Redis: {e}")
    
    def register_message_handler(self, message_type: MessageType, handler: Callable):
        """Register message handler for specific message type"""
        self.message_handlers[message_type] = handler
        logger.info(f"Registered handler for message type: {message_type}")
    
    async def cleanup(self):
        """Cleanup resources"""
        try:
            await self.disconnect()
            logger.info("Redis Streams manager cleaned up")
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")
