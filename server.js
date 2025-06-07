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

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  jwt.verify(
    token,
    process.env.JWT_SECRET || "fallback-secret",
    (err, user) => {
      if (err) {
        return res.status(403).json({ error: "Invalid token" });
      }
      req.user = user;
      next();
    }
  );
};

// Authorization middleware for managers
const requireManager = (req, res, next) => {
  if (req.user.role !== "manager") {
    return res.status(403).json({ error: "Manager access required" });
  }
  next();
};

// Helper function to calculate available capacity

const getAvailableCapacity = async (engineerId, startDate, endDate) => {
  try {
    const engineer = await User.findById(engineerId);
    if (!engineer) return 0;

    // Find overlapping assignments
    const overlappingAssignments = await Assignment.find({
      engineerId,
      $or: [
        {
          startDate: { $lte: endDate },
          endDate: { $gte: startDate },
        },
      ],
    });

    const totalAllocated = overlappingAssignments.reduce((sum, assignment) => {
      return sum + assignment.allocationPercentage;
    }, 0);

    return Math.max(0, engineer.maxCapacity - totalAllocated);
  } catch (error) {
    console.error("Error calculating available capacity:", error);
    return 0;
  }
};

// Authentication Routes
app.post("/api/auth/register", async (req, res) => {
  try {
    const {
      email,
      name,
      password,
      role,
      skills,
      seniority,
      maxCapacity,
      department,
    } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = new User({
      email,
      name,
      password: hashedPassword,
      role,
      skills: role === "engineer" ? skills : undefined,
      seniority: role === "engineer" ? seniority : undefined,
      maxCapacity: maxCapacity || 100,
      department,
    });

    await user.save();

    // Generate token
    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET || "fallback-secret",
      { expiresIn: "24h" }
    );

    res.status(201).json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        skills: user.skills,
        seniority: user.seniority,
        maxCapacity: user.maxCapacity,
        department: user.department,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    // Generate token
    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET || "fallback-secret",
      { expiresIn: "24h" }
    );

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        skills: user.skills,
        seniority: user.seniority,
        maxCapacity: user.maxCapacity,
        department: user.department,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/auth/profile", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("-password");
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Engineer Routes
app.get("/api/engineers", authenticateToken, async (req, res) => {
  try {
    const engineers = await User.find({ role: "engineer" }).select("-password");

    // Calculate current capacity for each engineer
    const engineersWithCapacity = await Promise.all(
      engineers.map(async (engineer) => {
        const currentDate = new Date();
        const futureDate = new Date();
        futureDate.setMonth(currentDate.getMonth() + 1);

        const availableCapacity = await getAvailableCapacity(
          engineer._id,
          currentDate,
          futureDate
        );

        return {
          ...engineer.toObject(),
          availableCapacity,
          currentAllocation: engineer.maxCapacity - availableCapacity,
        };
      })
    );

    res.json({ engineers: engineersWithCapacity });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/engineers/:id/capacity", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    const availableCapacity = await getAvailableCapacity(
      id,
      new Date(startDate),
      new Date(endDate)
    );

    res.json({ availableCapacity });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
