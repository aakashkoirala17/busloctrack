# Firebase Backend Setup Guide

To enable secure **Google Sign-In** verification on your server, you need to provide a **Service Account Key**.

## 1. Generate Service Account Key
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Select your project (**studio-3264384714-e1ead**).
3. Click the **Gear icon (Project Settings)** > **Service accounts**.
4. Click **Generate new private key**.
5. Save the JSON file that downloads.

## 2. Secure Your App
You have two options to use this key on Render:

### Option A: Environment Variable (Recommended for Render)
1. Open the JSON file you just downloaded.
2. Copy its **entire content**.
3. Go to your **Render Dashboard** > **BusLocTrack** > **Environment**.
4. Add a new environment variable:
   - **Key**: `FIREBASE_SERVICE_ACCOUNT`
   - **Value**: (Paste the entire JSON content here)
5. Save changes.

### Option B: Local Testing
If you want to test locally, you can create a file named `firebase-service-account.json` in your project root (it is already in `.gitignore` if you use common patterns, but be careful not to push it!).

---

## 3. Configure Google Sign-In
Ensure Google is enabled in **Authentication** > **Sign-in method**.

### Authorized Domains
Make sure your Render URL is added to the **Authorized domains** list in Firebase Authentication settings:
- `busloctrack.onrender.com`
- `localhost`

### Android SHA-1 Fingerprint
For the Android app to allow Google Sign-In, you **MUST** add your SHA-1 and SHA-256 fingerprints to the Project Settings in Firebase:
1. Run `./gradlew signingReport` in your `android` folder to get the fingerprints.
2. Add them to the **Android App** settings in Firebase.
3. Download the updated `google-services.json` (though I've already configured the web side for you).
