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

// Project Routes
app.get("/api/projects", authenticateToken, async (req, res) => {
  try {
    const projects = await Project.find()
      .populate("managerId", "name email")
      .sort({ createdAt: -1 });

    res.json({ projects });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post(
  "/api/projects",
  authenticateToken,
  requireManager,
  async (req, res) => {
    try {
      const project = new Project({
        ...req.body,
        managerId: req.user.userId,
      });

      await project.save();
      await project.populate("managerId", "name email");

      res.status(201).json({ project });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

app.get("/api/projects/:id", authenticateToken, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id).populate(
      "managerId",
      "name email"
    );

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    res.json({ project });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put(
  "/api/projects/:id",
  authenticateToken,
  requireManager,
  async (req, res) => {
    try {
      const project = await Project.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
      }).populate("managerId", "name email");

      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      res.json({ project });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

app.delete(
  "/api/projects/:id",
  authenticateToken,
  requireManager,
  async (req, res) => {
    try {
      const { id } = req.params;

      // Check if project exists
      const project = await Project.findById(id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Check if there are any active assignments for this project
      const activeAssignments = await Assignment.find({ projectId: id });
      if (activeAssignments.length > 0) {
        return res.status(400).json({
          error:
            "Cannot delete project with active assignments. Please remove all assignments first.",
        });
      }

      // Delete the project
      await Project.findByIdAndDelete(id);

      res.json({ message: "Project deleted successfully" });
    } catch (error) {
      console.error("Delete project error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Assignment Routes
app.get("/api/assignments", authenticateToken, async (req, res) => {
  try {
    let query = {};

    // If engineer, only show their assignments
    if (req.user.role === "engineer") {
      query.engineerId = req.user.userId;
    }

    const assignments = await Assignment.find(query)
      .populate("engineerId", "name email skills seniority")
      .populate("projectId", "name description status")
      .sort({ startDate: -1 });

    res.json({ assignments });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post(
  "/api/assignments",
  authenticateToken,
  requireManager,
  async (req, res) => {
    try {
      const {
        engineerId,
        projectId,
        allocationPercentage,
        startDate,
        endDate,
        role,
      } = req.body;

      console.log("Creating assignment with data:", {
        engineerId,
        projectId,
        allocationPercentage,
        startDate,
        endDate,
        role,
      });

      // Validate required fields
      if (
        !engineerId ||
        !projectId ||
        !allocationPercentage ||
        !startDate ||
        !endDate ||
        !role
      ) {
        return res.status(400).json({
          error:
            "Missing required fields. Need: engineerId, projectId, allocationPercentage, startDate, endDate, role",
        });
      }

      // Validate engineer exists
      const engineer = await User.findById(engineerId);
      if (!engineer) {
        return res.status(404).json({ error: "Engineer not found" });
      }

      // Validate project exists
      const project = await Project.findById(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Check if engineer has enough capacity
      const availableCapacity = await getAvailableCapacity(
        engineerId,
        new Date(startDate),
        new Date(endDate)
      );

      console.log(
        `Engineer ${engineer.name} has ${availableCapacity}% available capacity`
      );

      if (allocationPercentage > availableCapacity) {
        return res.status(400).json({
          error: `Engineer only has ${availableCapacity}% capacity available for this period. Requested: ${allocationPercentage}%`,
        });
      }

      // Create the assignment
      const assignment = new Assignment({
        engineerId,
        projectId,
        allocationPercentage: Number(allocationPercentage),
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        role: role || "Developer",
      });

      await assignment.save();

      // Populate the assignment with engineer and project details
      await assignment.populate("engineerId", "name email skills seniority");
      await assignment.populate("projectId", "name description status");

      console.log("Assignment created successfully:", assignment._id);

      res.status(201).json({ assignment });
    } catch (error) {
      console.error("Assignment creation error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

app.put(
  "/api/assignments/:id",
  authenticateToken,
  requireManager,
  async (req, res) => {
    try {
      const assignment = await Assignment.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true }
      )
        .populate("engineerId", "name email skills seniority")
        .populate("projectId", "name description status");

      if (!assignment) {
        return res.status(404).json({ error: "Assignment not found" });
      }

      res.json({ assignment });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

app.delete(
  "/api/assignments/:id",
  authenticateToken,
  requireManager,
  async (req, res) => {
    try {
      const assignment = await Assignment.findByIdAndDelete(req.params.id);

      if (!assignment) {
        return res.status(404).json({ error: "Assignment not found" });
      }

      res.json({ message: "Assignment deleted successfully" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Analytics Routes
app.get(
  "/api/analytics/utilization",
  authenticateToken,
  requireManager,
  async (req, res) => {
    try {
      const engineers = await User.find({ role: "engineer" });
      const currentDate = new Date();

      const utilizationData = await Promise.all(
        engineers.map(async (engineer) => {
          const assignments = await Assignment.find({
            engineerId: engineer._id,
            startDate: { $lte: currentDate },
            endDate: { $gte: currentDate },
          });

          const currentAllocation = assignments.reduce((sum, assignment) => {
            return sum + assignment.allocationPercentage;
          }, 0);

          return {
            engineerId: engineer._id,
            name: engineer.name,
            maxCapacity: engineer.maxCapacity,
            currentAllocation,
            utilizationPercentage:
              (currentAllocation / engineer.maxCapacity) * 100,
          };
        })
      );

      res.json({ utilizationData });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Seed data endpoint (for development)
app.post("/api/seed", async (req, res) => {
  try {
    // Clear existing data
    await User.deleteMany({});
    await Project.deleteMany({});
    await Assignment.deleteMany({});

    // Create sample users
    const hashedPassword = await bcrypt.hash("password123", 10);

    const users = await User.insertMany([
      {
        email: "manager@company.com",
        name: "Sarah Johnson",
        password: hashedPassword,
        role: "manager",
        department: "Engineering",
      },
      {
        email: "john@company.com",
        name: "John Doe",
        password: hashedPassword,
        role: "engineer",
        skills: ["React", "Node.js", "JavaScript", "MongoDB"],
        seniority: "senior",
        maxCapacity: 100,
        department: "Frontend",
      },
      {
        email: "alice@company.com",
        name: "Alice Smith",
        password: hashedPassword,
        role: "engineer",
        skills: ["Python", "Django", "PostgreSQL", "Docker"],
        seniority: "mid",
        maxCapacity: 100,
        department: "Backend",
      },
      {
        email: "bob@company.com",
        name: "Bob Wilson",
        password: hashedPassword,
        role: "engineer",
        skills: ["React", "TypeScript", "Next.js", "GraphQL"],
        seniority: "junior",
        maxCapacity: 50, // Part-time
        department: "Frontend",
      },
    ]);

    const manager = users.find((u) => u.role === "manager");

    // Create sample projects
    const projects = await Project.insertMany([
      {
        name: "E-commerce Platform",
        description:
          "Build a modern e-commerce platform with React and Node.js",
        startDate: new Date("2025-06-01"),
        endDate: new Date("2025-09-30"),
        requiredSkills: ["React", "Node.js", "MongoDB"],
        teamSize: 3,
        status: "active",
        managerId: manager._id,
      },
      {
        name: "Mobile App Backend",
        description: "REST API for mobile application",
        startDate: new Date("2025-07-01"),
        endDate: new Date("2025-10-15"),
        requiredSkills: ["Python", "Django", "PostgreSQL"],
        teamSize: 2,
        status: "planning",
        managerId: manager._id,
      },
      {
        name: "Dashboard Analytics",
        description: "Real-time analytics dashboard",
        startDate: new Date("2025-06-15"),
        endDate: new Date("2025-08-30"),
        requiredSkills: ["TypeScript", "React", "D3.js"],
        teamSize: 2,
        status: "active",
        managerId: manager._id,
      },
    ]);

    // Create sample assignments
    const engineers = users.filter((u) => u.role === "engineer");
    await Assignment.insertMany([
      {
        engineerId: engineers[0]._id, // John
        projectId: projects[0]._id,
        allocationPercentage: 60,
        startDate: new Date("2025-06-01"),
        endDate: new Date("2025-09-30"),
        role: "Tech Lead",
      },
      {
        engineerId: engineers[1]._id, // Alice
        projectId: projects[1]._id,
        allocationPercentage: 80,
        startDate: new Date("2025-07-01"),
        endDate: new Date("2025-10-15"),
        role: "Backend Developer",
      },
      {
        engineerId: engineers[2]._id, // Bob
        projectId: projects[2]._id,
        allocationPercentage: 40,
        startDate: new Date("2025-06-15"),
        endDate: new Date("2025-08-30"),
        role: "Frontend Developer",
      },
    ]);

    res.json({ message: "Sample data created successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
