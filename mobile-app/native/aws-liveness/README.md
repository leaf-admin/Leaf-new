# Leaf AWS Liveness Native Templates

These files are copied into the generated Expo native projects by
`mobile-app/plugins/withLeafAwsLiveness.js`.

Production contract:

- AWS Rekognition Face Liveness proves that a live person is in front of the camera.
- It does not prove that the person is the same one from the CNH photo.
- Identity match must be completed by the backend/microservice biometric comparison path.

The generated `ios/` and `android/` projects remain ignored in Git. Keep changes in this
template folder plus the config plugin so a clean prebuild can recreate the native bridge.
