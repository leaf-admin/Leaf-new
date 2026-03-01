# KYC Service Configuration

## Redis Configuration
REDIS_HOST = "localhost"
REDIS_PORT = 6379
REDIS_DB = 0
REDIS_PASSWORD = None

# Redis Streams
KYC_STREAM_NAME = "kyc:verification"
KYC_RESULT_STREAM = "kyc:results"

## OpenCV Configuration
FACE_DETECTION_CONFIDENCE = 0.7
FACE_MATCHING_THRESHOLD = 0.6
FACE_QUALITY_THRESHOLD = 0.5

## MediaPipe Configuration
MEDIAPIPE_MODEL_COMPLEXITY = 1
MEDIAPIPE_MIN_DETECTION_CONFIDENCE = 0.5
MEDIAPIPE_MIN_TRACKING_CONFIDENCE = 0.5

## API Configuration
API_HOST = "0.0.0.0"
API_PORT = 8000
API_WORKERS = 4

## Security Configuration
MAX_VERIFICATION_ATTEMPTS = 3
VERIFICATION_TIMEOUT = 30  # seconds
SESSION_EXPIRY = 300  # seconds

## Logging Configuration
LOG_LEVEL = "INFO"
LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
LOG_FILE = "logs/kyc_service.log"

## Performance Configuration
MAX_CONCURRENT_VERIFICATIONS = 10
IMAGE_PROCESSING_TIMEOUT = 10  # seconds
CACHE_TTL = 3600  # seconds

