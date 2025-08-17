import * as admin from 'firebase-admin';

// ---------- Firebase Admin init (service account via base64 env) ----------
let app;
if (!admin.apps?.length) {
  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64 || '', 'base64').toString('utf8')
  );
  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} else {
  app = admin.app();
}

const db = admin.firestore();

export const handler = async (event, context) => {
  try {
    // Require Netlify Identity user
    const user = context.clientContext && context.clientContext.user;
    if (!user) {
      return { statusCode: 401, body: 'Unauthorized' };
    }

    // Fetch posts ordered by latest
    const snapshot = await db.collection('posts').orderBy('timestamp', 'desc').limit(20).get();
    const posts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(posts)
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch feed', details: err.message })
    };
  }
};
