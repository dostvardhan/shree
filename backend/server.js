// server.js


const fileId = created.data.id;


// Save metadata
const photos = readPhotos();
const item = {
id: fileId,
name: created.data.name,
caption: req.body.caption || '',
uploadedBy: userEmail,
mimeType: created.data.mimeType,
size: created.data.size || null,
time: new Date().toISOString()
};
photos.unshift(item); // keep newest first
writePhotos(photos);


return res.json({ ok: true, item });
} catch(err) {
console.error('upload error', err);
return res.status(500).json({ error: 'upload_failed', details: err.message });
}
});


// List endpoint (supports ?limit=)
app.get('/api/list', checkJwt, (req, res) => {
const limit = parseInt(req.query.limit || '0');
const photos = readPhotos();
if(limit > 0) return res.json(photos.slice(0, limit));
res.json(photos);
});


// File streaming endpoint: get file from Drive and pipe to response
app.get('/api/file/:id', checkJwt, async (req, res) => {
try {
const id = req.params.id;
const drive = createDriveClient();


// get file metadata first (optional)
const meta = await drive.files.get({ fileId: id, fields: 'id, name, mimeType, size' });
res.setHeader('Content-Type', meta.data.mimeType || 'application/octet-stream');
res.setHeader('Content-Disposition', `inline; filename="${meta.data.name || id}"`);


const stream = await drive.files.get({ fileId: id, alt: 'media' }, { responseType: 'stream' });
stream.data.pipe(res);
} catch(err) {
console.error('file stream error', err);
res.status(500).json({ error: 'file_stream_failed', details: err.message });
}
});


app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
