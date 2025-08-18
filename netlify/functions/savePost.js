// netlify/functions/savePost.js
import * as admin from 'firebase-admin';

const { FIREBASE_SERVICE_ACCOUNT_B64, ALLOWED_EMAILS } = process.env;

// init Firebase Admin once
if (!admin.apps.length) {
  if (!FIREBASE_SERVICE_ACCOUNT_B64) {
    console.error('Missing FIREBASE_SERVICE_ACCOUNT_B64');
    throw new Error('FIREBASE_SERVICE_ACCOUNT_B64 missing');
  }
  const serviceAccount = JSON.parse(
    Buffer.from(FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8')
  );
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

export const handler = async (event, context) => {
  try{
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Require Netlify Identity user
    const user = context.clientContext && context.clientContext.user;
    if (!user) return { statusCode: 401, body: 'Unauthorized' };

    // Optional email allowlist
    if (ALLOWED_EMAILS) {
      const allowed = ALLOWED_EMAILS.split(',').map(s=>s.trim().toLowerCase());
      const email = (user.email || '').toLowerCase();
      if (!allowed.includes(email)){
        return { statusCode: 403, body: 'Forbidden: not invited' };
      }
    }

    const body = JSON.parse(event.body || '{}');
    const { url, public_id, caption = '' } = body;
    if (!url || !public_id) {
      return { statusCode: 400, body: 'Missing url/public_id' };
    }

    const doc = {
      url,
      public_id,
      caption: String(caption).slice(0, 2000),
      user: {
        id: user.sub || user.id || null,
        email: user.email || null,
        name: user.user_metadata?.full_name || null
      },
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    const ref = await db.collection('posts').add(doc);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ref.id, ...doc })
    };
  }catch(err){
    console.error(err);
    return { statusCode: 500, body: 'savePost failed: ' + err.message };
  }
};
