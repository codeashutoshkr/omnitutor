const { Storage } = require('@google-cloud/storage');
const { Firestore } = require('@google-cloud/firestore');

// Initialize clients (will look for GOOGLE_APPLICATION_CREDENTIALS in env)
const storage = new Storage();
const firestore = new Firestore();

const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'omnitutor-snapshots';
const COLLECTION_NAME = 'sessions';

async function uploadSnapshot(base64Image, sessionId = 'default-session') {
    try {
        const bucket = storage.bucket(BUCKET_NAME);
        
        // Ensure bucket exists or handle error here (in prod you'd create it via Terraform/CLI)
        const filename = `snapshot_${sessionId}_${Date.now()}.jpg`;
        const file = bucket.file(filename);

        // Convert base64 to buffer
        const imageBuffer = Buffer.from(base64Image, 'base64');
        
        await file.save(imageBuffer, {
            metadata: { contentType: 'image/jpeg' },
            public: true // Optional: make public so frontend can render it, or just use signed urls
        });

        const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${filename}`;
        
        // Log this action to Firestore
        await logAction(sessionId, 'Snapshot Saved', { imageUrl: publicUrl });

        return publicUrl;
    } catch (error) {
        console.error('Error uploading snapshot to GCS:', error);
        throw error;
    }
}

async function logAction(sessionId, action, details = {}) {
    try {
        const sessionRef = firestore.collection(COLLECTION_NAME).doc(sessionId);
        const logRef = sessionRef.collection('logs').doc();
        
        await logRef.set({
            action,
            timestamp: new Date(),
            ...details
        });
        
    } catch (error) {
         console.error('Error logging to Firestore:', error);
    }
}

module.exports = {
    uploadSnapshot,
    logAction
};
