// ----------------- CORS (make sure Authorization allowed) -----------------
app.use(cors({
  origin: 'https://shreshthapushkar.com',
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Authorization','Content-Type'],
}));

// ----------------- PHOTO STREAM ROUTE -----------------
app.get('/photo/:id', requireAuth, async (req, res) => {
  const fileId = req.params.id;
  try {
    // Step 1: Fetch metadata (to set headers + validate existence)
    const meta = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,size,modifiedTime'
    });

    const name = meta.data.name || 'file';
    const mime = meta.data.mimeType || 'application/octet-stream';

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`);
    res.setHeader('Cache-Control', 'private, max-age=60');

    // Step 2: Stream the actual media content
    const dl = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });

    dl.data.on('error', (err) => {
      console.error('Stream error:', err?.message || err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Stream failed' });
      } else {
        res.destroy(err);
      }
    });

    dl.data.pipe(res);
  } catch (err) {
    const code = err?.code || err?.response?.status || 500;
    console.error('PHOTO route error:', code, err?.message || err);
    if (!res.headersSent) {
      res.status(code === 404 ? 404 : 500)
         .json({ error: code === 404 ? 'Not found' : 'Failed to fetch file' });
    } else {
      res.end();
    }
  }
});
