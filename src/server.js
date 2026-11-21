require("dotenv").config();
const path = require("path");
const express = require("express");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const app = express();

app.use(express.json({ limit: "100kb" }));

// Lets you see which server answered (used to prove load balancing)
app.use((req, res, next) => {
  res.setHeader("X-Served-By", process.env.SERVER_NAME || "local");
  next();
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/events", require("./routes/events"));
app.use("/api/patients", require("./routes/patients"));
app.use("/api/medications", require("./routes/medications"));

app.use("/api", notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
