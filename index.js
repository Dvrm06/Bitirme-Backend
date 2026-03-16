const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const pino = require("pino");
const pinoHttp = require("pino-http");


require("dotenv").config();

const app = express();

// Logger: logs on response end for every HTTP request
const logger = pino({ level: process.env.LOG_LEVEL || "info" });
app.use(pinoHttp({ logger }));

const corsOptions = {
    origin: "*",
    //Local'de çalıştırırken sorun çıktığı için alttaki kodu kullanıyorum
    /*
    origin: "http://localhost:5173",
    credentials: true
    */
};

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database connection is handled in components/models/db.js

// Base API URL
const BASE_URL = "/api";

// Routes
const users = require("./components/users");
const departments = require("./components/departments");
const lessons = require("./components/lessons");
const lessonGroups = require("./components/lessonGroups");
const ai = require("./components/ai");

app.use(`${BASE_URL}/users`, users);
app.use(`${BASE_URL}/departments`, departments);
app.use(`${BASE_URL}/lessons`, lessons);
app.use(`${BASE_URL}/lessonGroups`, lessonGroups);
app.use(`${BASE_URL}/ai`, ai);

// Simple route
app.get("/", (req, res) => {
    res.json({ message: "Welcome to the application." });
});

// Port configuration
const PORT = process.env.PORT || 8001;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}.`);
});
