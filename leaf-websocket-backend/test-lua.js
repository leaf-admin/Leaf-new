const { Redis } = require('ioredis');
const redis = new Redis({ host: 'localhost', port: 6380, password: 'leaf_redis_password_secure' });
async function run() {
  try {
    await redis.hset('booking:testlua', 'state', 'PENDING', 'status', 'pending');
    const luaScript = `
        local bookingKey = KEYS[1]
        local driverId = ARGV[1]
        local newState = ARGV[2]
        local updatedAt = ARGV[3]

        if redis.call('EXISTS', bookingKey) == 0 then
            return 'ERR_NOT_FOUND'
        end

        local currentState = redis.call('HGET', bookingKey, 'state')
        local currentStatus = redis.call('HGET', bookingKey, 'status')
        
        if currentState ~= 'PENDING' and currentState ~= 'REQUESTED' and currentState ~= 'SEARCHING' and currentStatus ~= 'pending' then
            return 'ERR_INVALID_STATE_' .. (currentState or 'null')
        end

        -- Realiza o update atômico
        redis.call('HMSET', bookingKey, 
            'state', newState, 
            'status', 'ACCEPTED', 
            'driverId', driverId, 
            'updatedAt', updatedAt, 
            'acceptedAt', updatedAt
        )

        -- Retorna dados complementares concatenados (customerId|||pickupLocation)
        local customerId = redis.call('HGET', bookingKey, 'customerId')
        local pickupLoc = redis.call('HGET', bookingKey, 'pickupLocation')
        return (customerId or '') .. '|||' .. (pickupLoc or '')
    `;

    const res = await redis.eval(luaScript, 1, 'booking:testlua', 'driverA', 'ACCEPTED', '2023');
    console.log("Success:", res);
  } catch (e) {
    console.log("Error:", e.message);
  } finally {
    redis.quit();
  }
}
run();
