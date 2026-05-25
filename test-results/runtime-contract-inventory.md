# Runtime Contract Inventory

Generated at: 2026-05-24T22:02:36.826Z
Root: `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend`

## Summary

- HTTP routes: 59
- Socket events: 114
- HTTP by runtime: `{"modular":30,"vps":29}`
- Socket by runtime: `{"modular":65,"vps":49}`

## Parity

- Shared HTTP routes: 29
- HTTP only in VPS runtime: 0
- HTTP only in modular runtime: 1
- Shared socket events: 49
- Socket events only in VPS runtime: 0
- Socket events only in modular runtime: 14

## HTTP Only In VPS

- None

## HTTP Only In Modular

- USE:/api/demand (bootstrap/register-http-routes.js)

## Socket Events Only In VPS

- None

## Socket Events Only In Modular

- socket:on:apply_promo (bootstrap/register-socket-legacy-bridge-handler.js)
- socket:on:arriveAtPickup (bootstrap/register-socket-driver-control-handlers.js)
- socket:on:getTripRatings (bootstrap/register-socket-legacy-bridge-handler.js)
- socket:on:getUserRatings (bootstrap/register-socket-legacy-bridge-handler.js)
- socket:on:get_promo_by_code (bootstrap/register-socket-legacy-bridge-handler.js)
- socket:on:get_promos (bootstrap/register-socket-legacy-bridge-handler.js)
- socket:on:get_user_chats (bootstrap/register-socket-legacy-bridge-handler.js)
- socket:on:get_user_promos (bootstrap/register-socket-legacy-bridge-handler.js)
- socket:on:hasUserRatedTrip (bootstrap/register-socket-legacy-bridge-handler.js)
- socket:on:load_messages (bootstrap/register-socket-legacy-bridge-handler.js)
- socket:on:mark_messages_read (bootstrap/register-socket-legacy-bridge-handler.js)
- socket:on:typing_start (bootstrap/register-socket-legacy-bridge-handler.js)
- socket:on:typing_stop (bootstrap/register-socket-legacy-bridge-handler.js)
- socket:on:validate_promo_code (bootstrap/register-socket-legacy-bridge-handler.js)
