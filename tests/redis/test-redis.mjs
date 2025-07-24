// Test script for Redis integration
import redisLocationService from './common/src/services/redisLocationService.mjs';
import redisTrackingService from './common/src/services/redisTrackingService.mjs';
import { FEATURE_FLAGS, getRedisConfig } from './common/src/config/redisConfig.mjs';

console.log('🧪 Testing Redis Integration for LEAF ReactNative Project');
console.log('==================================================');

async function testRedisConnection() {
    console.log('\n1. Testing Redis Connection...');
    
    try {
        // Test Location Service
        const locationConnected = await redisLocationService.connect();
        console.log(`✅ Location Service: ${locationConnected ? 'Connected' : 'Failed'}`);
        
        // Test Tracking Service
        const trackingConnected = await redisTrackingService.connect();
        console.log(`✅ Tracking Service: ${trackingConnected ? 'Connected' : 'Failed'}`);
        
        return locationConnected && trackingConnected;
    } catch (error) {
        console.error('❌ Connection failed:', error.message);
        return false;
    }
}

async function testLocationService() {
    console.log('\n2. Testing Location Service...');
    
    try {
        const testUid = 'test-user-123';
        const testLocation = {
            lat: -23.5505,
            lng: -46.6333,
            error: false
        };
        
        // Save location
        await redisLocationService.saveUserLocation(testUid, testLocation);
        console.log('✅ Location saved successfully');
        
        // Get location
        const retrievedLocation = await redisLocationService.getUserLocation(testUid);
        console.log('✅ Location retrieved:', retrievedLocation);
        
        // Test nearby drivers
        const nearbyDrivers = await redisLocationService.getNearbyDrivers(-23.5505, -46.6333, 5);
        console.log('✅ Nearby drivers found:', nearbyDrivers.length);
        
        // Test online users
        const onlineUsers = await redisLocationService.getOnlineUsers();
        console.log('✅ Online users:', onlineUsers.length);
        
        return true;
    } catch (error) {
        console.error('❌ Location service test failed:', error.message);
        return false;
    }
}

async function testTrackingService() {
    console.log('\n3. Testing Tracking Service...');
    
    try {
        const testBookingId = 'test-booking-456';
        const testTrackingPoint = {
            lat: -23.5505,
            lng: -46.6333,
            status: 'STARTED',
            at: Date.now()
        };
        
        // Add tracking point
        const entryId = await redisTrackingService.addTrackingPoint(testBookingId, testTrackingPoint);
        console.log('✅ Tracking point added:', entryId);
        
        // Get last point
        const lastPoint = await redisTrackingService.getLastTrackingPoint(testBookingId);
        console.log('✅ Last tracking point:', lastPoint);
        
        // Get history
        const history = await redisTrackingService.getTrackingHistory(testBookingId, 10);
        console.log('✅ Tracking history points:', history.length);
        
        // Calculate distance
        const distance = await redisTrackingService.calculateTripDistance(testBookingId);
        console.log('✅ Trip distance calculated:', distance.distance.toFixed(2), 'km');
        
        return true;
    } catch (error) {
        console.error('❌ Tracking service test failed:', error.message);
        return false;
    }
}

async function testPubSub() {
    console.log('\n4. Testing Pub/Sub...');
    
    try {
        const testUid = 'test-user-pubsub';
        const testBookingId = 'test-booking-pubsub';
        
        // Subscribe to location updates
        await redisLocationService.subscribeToLocation(testUid, (location) => {
            console.log('📍 Location update received:', location);
        });
        console.log('✅ Subscribed to location updates');
        
        // Subscribe to tracking updates
        await redisTrackingService.subscribeToTracking(testBookingId, (tracking) => {
            console.log('🚗 Tracking update received:', tracking);
        });
        console.log('✅ Subscribed to tracking updates');
        
        // Publish some test data
        setTimeout(async () => {
            await redisLocationService.saveUserLocation(testUid, {
                lat: -23.5505,
                lng: -46.6333
            });
            
            await redisTrackingService.addTrackingPoint(testBookingId, {
                lat: -23.5505,
                lng: -46.6333,
                status: 'MOVING'
            });
        }, 1000);
        
        return true;
    } catch (error) {
        console.error('❌ Pub/Sub test failed:', error.message);
        return false;
    }
}

async function testConfiguration() {
    console.log('\n5. Testing Configuration...');
    
    try {
        const config = getRedisConfig();
        console.log('✅ Redis config loaded:', {
            url: config.url,
            ttl: config.ttl.userLocation
        });
        
        console.log('✅ Feature flags:', {
            USE_REDIS_LOCATION: FEATURE_FLAGS.USE_REDIS_LOCATION,
            USE_REDIS_TRACKING: FEATURE_FLAGS.USE_REDIS_TRACKING,
            FALLBACK_TO_FIREBASE: FEATURE_FLAGS.FALLBACK_TO_FIREBASE
        });
        
        return true;
    } catch (error) {
        console.error('❌ Configuration test failed:', error.message);
        return false;
    }
}

async function runAllTests() {
    const tests = [
        { name: 'Connection', fn: testRedisConnection },
        { name: 'Location Service', fn: testLocationService },
        { name: 'Tracking Service', fn: testTrackingService },
        { name: 'Pub/Sub', fn: testPubSub },
        { name: 'Configuration', fn: testConfiguration }
    ];
    
    let passed = 0;
    let total = tests.length;
    
    for (const test of tests) {
        try {
            const result = await test.fn();
            if (result) {
                passed++;
            }
        } catch (error) {
            console.error(`❌ ${test.name} test error:`, error.message);
        }
    }
    
    console.log('\n==================================================');
    console.log(`🎯 Test Results: ${passed}/${total} tests passed`);
    
    if (passed === total) {
        console.log('🎉 All tests passed! Redis integration is ready!');
    } else {
        console.log('⚠️  Some tests failed. Check the logs above.');
    }
    
    // Cleanup
    await redisLocationService.disconnect();
    await redisTrackingService.disconnect();
    
    process.exit(passed === total ? 0 : 1);
}

// Run tests
runAllTests().catch(error => {
    console.error('❌ Test runner failed:', error);
    process.exit(1);
}); 