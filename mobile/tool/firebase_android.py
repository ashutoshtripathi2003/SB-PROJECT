"""Turn Firebase's google-services.json into the Android settings the app reads at startup.

Same values the google-services Gradle plugin would generate, without adding that plugin to the
build. Usage: python3 tool/firebase_android.py google-services.json
Writes android/app/src/main/res/values/firebase.xml (git-ignored). Without it, push stays off.
"""
import json
import sys
from pathlib import Path
from xml.sax.saxutils import escape

PACKAGE = "com.ridesync.ridesync"
OUT = Path(__file__).resolve().parent.parent / "android/app/src/main/res/values/firebase.xml"

data = json.loads(Path(sys.argv[1]).read_text())
client = next((c for c in data["client"] if c["client_info"]["android_client_info"]["package_name"] == PACKAGE), None)
if client is None:
    sys.exit(f"google-services.json has no Android app with package name {PACKAGE}. Add one in the Firebase console.")
values = {
    "google_app_id": client["client_info"]["mobilesdk_app_id"],
    "gcm_defaultSenderId": data["project_info"]["project_number"],
    "google_api_key": client["api_key"][0]["current_key"],
    "google_crash_reporting_api_key": client["api_key"][0]["current_key"],
    "project_id": data["project_info"]["project_id"],
}
if data["project_info"].get("storage_bucket"):
    values["google_storage_bucket"] = data["project_info"]["storage_bucket"]
rows = "\n".join(f'    <string name="{k}" translatable="false">{escape(str(v))}</string>' for k, v in values.items())
OUT.write_text(f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n{rows}\n</resources>\n')
print(f"Firebase settings written for project {values['project_id']}")
