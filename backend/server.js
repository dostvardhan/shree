import express from "express";

const app = express();

app.get("/", (req, res) => {
  res.send("Shree Drive Uploader OK");
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
