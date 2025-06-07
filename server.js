// server.js - Main Express server
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI).then(() => {
  console.log("Connected to DB");
});

// Database Models
const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["engineer", "manager"], required: true },
    skills: [String], // For engineers
    seniority: { type: String, enum: ["junior", "mid", "senior"] },
    maxCapacity: { type: Number, default: 100 }, // 100 for full-time, 50 for part-time
    department: String,
  },
  { timestamps: true }
);

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: String,
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    requiredSkills: [String],
    teamSize: { type: Number, required: true },
    status: {
      type: String,
      enum: ["planning", "active", "completed"],
      default: "planning",
    },
    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ermUser",
      required: true,
    },
  },
  { timestamps: true }
);

const assignmentSchema = new mongoose.Schema(
  {
    engineerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ermUser",
      required: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ermProject",
      required: true,
    },
    allocationPercentage: { type: Number, required: true, min: 0, max: 100 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    role: { type: String, default: "Developer" }, // Developer, Tech Lead, etc.
  },
  { timestamps: true }
);

const User = mongoose.model("ermUser", userSchema);
const Project = mongoose.model("ermProject", projectSchema);
const Assignment = mongoose.model("ermAssignment", assignmentSchema);

const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
