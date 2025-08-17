import * as admin from 'firebase-admin';

const { FIREBASE_SERVICE_ACCOUNT_B64 } = process.env;

let app;
if (!admin.apps?.length) {
  const serviceAccount = JSON.parse(
    Buffer.from(FIREBASE_SERVICE_ACCOUNT_B64 || '', 'base64').toString('utf8')
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
    const user = context.clientContext && context.clientContext.user;
    if (!user) {
      return { statusCode: 401, body: 'Unauthorized' };
    }

    const snap = await db
      .collection('posts')
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();

    const items = snap.docs.map(d => ({ id: d.id, ...d.data(), timestamp: d.data().timestamp?.toDate?.() || null }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items)
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'Feed error: ' + err.message };
  }
};
