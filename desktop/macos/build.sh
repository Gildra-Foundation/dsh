#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
BUILD_DIR="$SCRIPT_DIR/build"
APP_BUNDLE="$BUILD_DIR/Gildra DSH.app"
EXECUTABLE="$APP_BUNDLE/Contents/MacOS/DeepSeekHarnessApp"

/bin/rm -rf "$BUILD_DIR"
/bin/mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"

SOURCES=("$SCRIPT_DIR"/*.swift "$SCRIPT_DIR"/Host/*.swift)

/usr/bin/xcrun swiftc \
    -O \
    -parse-as-library \
    -framework AppKit \
    -framework Combine \
    -framework SwiftUI \
    -framework WebKit \
    "${SOURCES[@]}" \
    -o "$EXECUTABLE"

/bin/cp "$SCRIPT_DIR/Info.plist" "$APP_BUNDLE/Contents/Info.plist"
KIT_VERSION="$(/usr/bin/plutil -extract distribution.version raw -o - "$SCRIPT_DIR/../../config/kit.json")"
BUNDLE_VERSION="${KIT_VERSION%%-*}"
/usr/bin/plutil -replace CFBundleShortVersionString -string "$KIT_VERSION" "$APP_BUNDLE/Contents/Info.plist"
/usr/bin/plutil -replace CFBundleVersion -string "$BUNDLE_VERSION" "$APP_BUNDLE/Contents/Info.plist"
/bin/cp "$SCRIPT_DIR/AppIcon.icns" "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
/bin/cp "$SCRIPT_DIR/../../config/kit.json" "$APP_BUNDLE/Contents/Resources/kit.json"
/usr/bin/codesign --force --sign - "$APP_BUNDLE"

echo "$APP_BUNDLE"
