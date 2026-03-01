#!/bin/bash

# KYC Service Test Script
# Tests the KYC service functionality

set -e

echo "🧪 TESTING KYC SERVICE..."
echo "====================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
API_BASE_URL="http://localhost:8000"
TEST_IMAGES_DIR="./test_images"
RESULTS_DIR="./test_results"

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if service is running
check_service() {
    log_info "Checking if KYC service is running..."
    
    if curl -s "$API_BASE_URL/health" | grep -q "healthy"; then
        log_info "✅ KYC service is running"
        return 0
    else
        log_error "❌ KYC service is not running"
        return 1
    fi
}

# Test health endpoint
test_health() {
    log_info "Testing health endpoint..."
    
    response=$(curl -s "$API_BASE_URL/health")
    
    if echo "$response" | grep -q "healthy"; then
        log_info "✅ Health endpoint test passed"
        echo "Response: $response"
    else
        log_error "❌ Health endpoint test failed"
        echo "Response: $response"
        return 1
    fi
}

# Test root endpoint
test_root() {
    log_info "Testing root endpoint..."
    
    response=$(curl -s "$API_BASE_URL/")
    
    if echo "$response" | grep -q "running"; then
        log_info "✅ Root endpoint test passed"
        echo "Response: $response"
    else
        log_error "❌ Root endpoint test failed"
        echo "Response: $response"
        return 1
    fi
}

# Create test images
create_test_images() {
    log_info "Creating test images..."
    
    mkdir -p "$TEST_IMAGES_DIR"
    
    # Create a simple test image using ImageMagick
    if command -v convert &> /dev/null; then
        # Create a simple face-like image
        convert -size 200x200 xc:white \
                -fill black -draw "circle 100,80 100,60" \
                -fill black -draw "circle 100,120 100,100" \
                -fill black -draw "ellipse 100,150 30,10" \
                "$TEST_IMAGES_DIR/test_face.jpg"
        
        # Create a profile image (same as test face for testing)
        cp "$TEST_IMAGES_DIR/test_face.jpg" "$TEST_IMAGES_DIR/profile_face.jpg"
        
        log_info "✅ Test images created"
    else
        log_warn "⚠️ ImageMagick not found, skipping image creation"
        log_warn "Please install ImageMagick or provide test images manually"
    fi
}

# Test face verification
test_face_verification() {
    log_info "Testing face verification..."
    
    if [ ! -f "$TEST_IMAGES_DIR/test_face.jpg" ]; then
        log_error "❌ Test image not found"
        return 1
    fi
    
    # Convert image to base64
    image_base64=$(base64 -w 0 "$TEST_IMAGES_DIR/test_face.jpg")
    profile_base64=$(base64 -w 0 "$TEST_IMAGES_DIR/profile_face.jpg")
    
    # Create JSON payload
    json_payload=$(cat << EOF
{
    "driver_id": "test_driver_001",
    "session_id": "test_session_001",
    "image_data": "data:image/jpeg;base64,$image_base64",
    "profile_image": "data:image/jpeg;base64,$profile_base64",
    "verification_type": "face_verification"
}
EOF
)
    
    # Send verification request
    response=$(curl -s -X POST "$API_BASE_URL/verify" \
        -H "Content-Type: application/json" \
        -d "$json_payload")
    
    if echo "$response" | grep -q "message_id"; then
        log_info "✅ Face verification test passed"
        echo "Response: $response"
    else
        log_error "❌ Face verification test failed"
        echo "Response: $response"
        return 1
    fi
}

# Test liveness check
test_liveness_check() {
    log_info "Testing liveness check..."
    
    if [ ! -f "$TEST_IMAGES_DIR/test_face.jpg" ]; then
        log_error "❌ Test image not found"
        return 1
    fi
    
    # Send liveness check request
    response=$(curl -s -X POST "$API_BASE_URL/liveness-check" \
        -F "driver_id=test_driver_001" \
        -F "session_id=test_session_001" \
        -F "image=@$TEST_IMAGES_DIR/test_face.jpg")
    
    if echo "$response" | grep -q "status"; then
        log_info "✅ Liveness check test passed"
        echo "Response: $response"
    else
        log_error "❌ Liveness check test failed"
        echo "Response: $response"
        return 1
    fi
}

# Test status endpoint
test_status_endpoint() {
    log_info "Testing status endpoint..."
    
    response=$(curl -s "$API_BASE_URL/status/test_driver_001/test_session_001")
    
    if echo "$response" | grep -q "driver_id"; then
        log_info "✅ Status endpoint test passed"
        echo "Response: $response"
    else
        log_warn "⚠️ Status endpoint test failed (may be expected if no updates)"
        echo "Response: $response"
    fi
}

# Test Redis Streams integration
test_redis_streams() {
    log_info "Testing Redis Streams integration..."
    
    # Check if Redis is running
    if systemctl is-active --quiet redis-server; then
        log_info "✅ Redis is running"
        
        # Check Redis connection
        if redis-cli ping | grep -q "PONG"; then
            log_info "✅ Redis connection test passed"
        else
            log_error "❌ Redis connection test failed"
            return 1
        fi
    else
        log_error "❌ Redis is not running"
        return 1
    fi
}

# Performance test
test_performance() {
    log_info "Running performance test..."
    
    if [ ! -f "$TEST_IMAGES_DIR/test_face.jpg" ]; then
        log_error "❌ Test image not found"
        return 1
    fi
    
    # Convert image to base64
    image_base64=$(base64 -w 0 "$TEST_IMAGES_DIR/test_face.jpg")
    profile_base64=$(base64 -w 0 "$TEST_IMAGES_DIR/profile_face.jpg")
    
    # Create JSON payload
    json_payload=$(cat << EOF
{
    "driver_id": "perf_test_driver",
    "session_id": "perf_test_session",
    "image_data": "data:image/jpeg;base64,$image_base64",
    "profile_image": "data:image/jpeg;base64,$profile_base64",
    "verification_type": "face_verification"
}
EOF
)
    
    # Run performance test
    start_time=$(date +%s.%N)
    
    for i in {1..5}; do
        response=$(curl -s -X POST "$API_BASE_URL/verify" \
            -H "Content-Type: application/json" \
            -d "$json_payload")
        
        if echo "$response" | grep -q "message_id"; then
            log_info "✅ Performance test iteration $i passed"
        else
            log_error "❌ Performance test iteration $i failed"
            return 1
        fi
    done
    
    end_time=$(date +%s.%N)
    duration=$(echo "$end_time - $start_time" | bc)
    
    log_info "✅ Performance test completed in ${duration}s"
}

# Generate test report
generate_report() {
    log_info "Generating test report..."
    
    mkdir -p "$RESULTS_DIR"
    
    report_file="$RESULTS_DIR/test_report_$(date +%Y%m%d_%H%M%S).txt"
    
    cat > "$report_file" << EOF
KYC Service Test Report
Generated: $(date)
=====================================================

Service Information:
- API Base URL: $API_BASE_URL
- Test Images Directory: $TEST_IMAGES_DIR
- Results Directory: $RESULTS_DIR

Test Results:
- Health Endpoint: $(curl -s "$API_BASE_URL/health" | grep -q "healthy" && echo "PASS" || echo "FAIL")
- Root Endpoint: $(curl -s "$API_BASE_URL/" | grep -q "running" && echo "PASS" || echo "FAIL")
- Redis Status: $(systemctl is-active --quiet redis-server && echo "RUNNING" || echo "STOPPED")
- Service Status: $(systemctl is-active --quiet kyc-service && echo "RUNNING" || echo "STOPPED")

System Information:
- OS: $(uname -a)
- Python Version: $(python3 --version)
- Redis Version: $(redis-server --version)
- OpenCV Version: $(python3 -c "import cv2; print(cv2.__version__)" 2>/dev/null || echo "Not installed")

EOF
    
    log_info "✅ Test report generated: $report_file"
}

# Main test function
run_tests() {
    log_info "Starting KYC service tests..."
    
    # Check if service is running
    if ! check_service; then
        log_error "❌ KYC service is not running. Please start the service first."
        exit 1
    fi
    
    # Run tests
    test_health
    test_root
    create_test_images
    test_face_verification
    test_liveness_check
    test_status_endpoint
    test_redis_streams
    test_performance
    
    # Generate report
    generate_report
    
    log_info "✅ All tests completed!"
}

# Cleanup function
cleanup() {
    log_info "Cleaning up test files..."
    rm -rf "$TEST_IMAGES_DIR"
    log_info "✅ Cleanup completed"
}

# Main execution
case "${1:-run}" in
    "run")
        run_tests
        ;;
    "cleanup")
        cleanup
        ;;
    "health")
        test_health
        ;;
    "verification")
        test_face_verification
        ;;
    "liveness")
        test_liveness_check
        ;;
    "performance")
        test_performance
        ;;
    *)
        echo "Usage: $0 [run|cleanup|health|verification|liveness|performance]"
        echo ""
        echo "Commands:"
        echo "  run         - Run all tests (default)"
        echo "  cleanup     - Clean up test files"
        echo "  health      - Test health endpoint only"
        echo "  verification - Test face verification only"
        echo "  liveness    - Test liveness check only"
        echo "  performance - Run performance test only"
        exit 1
        ;;
esac

