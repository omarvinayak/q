import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const envPath = [
  join(projectRoot, '.env'),
  join(projectRoot, 'module.env'),
].find(path => existsSync(path));
if (envPath) {
  const result = dotenv.config({ path: envPath });
  if (result.error) throw result.error;
  if (envPath.endsWith('module.env')) {
    console.warn('Loaded environment from module.env; .env is preferred for new configuration.');
  }
}

const app = express();
const PORT = Number(process.env.PORT || 5000);
const JWT_SECRET = process.env.JWT_SECRET;
const categories = ['Faculty', 'Library', 'Food court', 'Parking', 'Laboratory', 'Campus infrastructure'];
const clientOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: clientOrigins }));
app.use(express.json({ limit: '20kb' }));

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['student', 'host'], required: true },
  studentId: { type: String, trim: true, maxlength: 50, sparse: true, unique: true },
}, { timestamps: true });
const feedbackSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  category: { type: String, enum: categories, required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: { type: String, required: true, trim: true, minlength: 5, maxlength: 3000 },
  anonymous: { type: Boolean, default: false },
}, { timestamps: true });
const complaintSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subject: { type: String, required: true, trim: true, maxlength: 150 },
  category: { type: String, enum: categories, required: true },
  description: { type: String, required: true, trim: true, minlength: 10, maxlength: 3000 },
  status: { type: String, enum: ['open', 'in progress', 'resolved'], default: 'open' },
}, { timestamps: true });
const questionSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true, maxlength: 250 },
  category: { type: String, enum: categories, required: true },
}, { timestamps: true });
const periodSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
}, { timestamps: true });
const settingSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'global' },
  registrationEnabled: { type: Boolean, default: true },
  campusName: { type: String, default: 'CampusVoice', maxlength: 100 },
});
const User = mongoose.model('User', userSchema);
const Feedback = mongoose.model('Feedback', feedbackSchema);
const Complaint = mongoose.model('Complaint', complaintSchema);
const FeedbackQuestion = mongoose.model('FeedbackQuestion', questionSchema);
const FeedbackPeriod = mongoose.model('FeedbackPeriod', periodSchema);
const Setting = mongoose.model('Setting', settingSchema);

function route(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
function issueToken(user) {
  return jwt.sign({ sub: user._id.toString() }, JWT_SECRET, { expiresIn: '12h' });
}
function publicUser(user) {
  return { id: user._id, name: user.name, email: user.email, role: user.role, studentId: user.studentId || null };
}
async function authenticate(req, res, next) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ message: 'Please sign in to continue.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.sub).select('_id name email role studentId');
    if (!user) return res.status(401).json({ message: 'Your session is no longer valid. Please sign in again.' });
    req.user = user;
    return next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
    }
    return next(error);
  }
}
function requireRole(role) {
  return (req, res, next) => req.user?.role === role
    ? next()
    : res.status(403).json({ message: 'You do not have permission to access this resource.' });
}
const studentOnly = [authenticate, requireRole('student')];
const hostOnly = [authenticate, requireRole('host')];
const validCategory = value => categories.includes(value);
const limitFrom = value => Math.min(Math.max(Number.parseInt(value, 10) || 100, 1), 200);

app.get('/api/health', (_req, res) => {
  const databaseConnected = mongoose.connection.readyState === 1;
  res.status(databaseConnected ? 200 : 503).json({
    status: databaseConnected ? 'ok' : 'database-unavailable',
    databaseConnected,
  });
});
app.get('/api/public/stats', route(async (_req, res) => {
  const [students, feedback] = await Promise.all([
    User.countDocuments({ role: 'student' }),
    Feedback.countDocuments(),
  ]);
  res.json({ students, feedback });
}));

app.post('/api/auth/login', route(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const role = req.body?.role;
  if (!email || !password || !['student', 'host'].includes(role)) {
    return res.status(400).json({ message: 'Enter your email and password.' });
  }
  const user = await User.findOne({ email, role }).select('+passwordHash');
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ message: 'Email or password is incorrect.' });
  }
  res.json({ token: issueToken(user), user: publicUser(user) });
}));
app.post('/api/auth/register', route(async (req, res) => {
  const { name, email, password, role, studentId } = req.body || {};
  if (role !== 'student') return res.status(403).json({ message: 'Only student accounts can be registered here.' });
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
    return res.status(400).json({ message: 'Enter a name between 2 and 100 characters.' });
  }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254) {
    return res.status(400).json({ message: 'Enter a valid email address.' });
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ message: 'Password must be between 8 and 128 characters.' });
  }
  if (typeof studentId !== 'string' || studentId.trim().length < 1 || studentId.trim().length > 50) {
    return res.status(400).json({ message: 'Enter a valid student ID.' });
  }
  const settings = await Setting.findOne({ key: 'global' });
  if (settings?.registrationEnabled === false) {
    return res.status(403).json({ message: 'Student registration is currently closed.' });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const user = await User.create({ name: name.trim(), email: email.trim().toLowerCase(), passwordHash, role: 'student', studentId: studentId.trim() });
    res.status(201).json({ token: issueToken(user), user: publicUser(user) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: 'An account with that email or student ID already exists.' });
    throw error;
  }
}));

app.get('/api/student/summary', ...studentOnly, route(async (req, res) => {
  const [feedbackCount, openComplaints, resolvedComplaints] = await Promise.all([
    Feedback.countDocuments({ student: req.user._id }),
    Complaint.countDocuments({ student: req.user._id, status: { $ne: 'resolved' } }),
    Complaint.countDocuments({ student: req.user._id, status: 'resolved' }),
  ]);
  res.json({ feedbackCount, openComplaints, resolvedComplaints });
}));
app.get('/api/student/feedback', ...studentOnly, route(async (req, res) => {
  const items = await Feedback.find({ student: req.user._id }).sort({ createdAt: -1 }).limit(limitFrom(req.query.limit));
  res.json(items);
}));
app.post('/api/student/feedback', ...studentOnly, route(async (req, res) => {
  const { category, rating, comment, anonymous = false } = req.body || {};
  if (!validCategory(category)) return res.status(400).json({ message: 'Choose a valid feedback category.' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ message: 'Choose a rating from 1 to 5.' });
  if (typeof comment !== 'string' || comment.trim().length < 5 || comment.trim().length > 3000) {
    return res.status(400).json({ message: 'Feedback must be between 5 and 3,000 characters.' });
  }
  if (typeof anonymous !== 'boolean') return res.status(400).json({ message: 'Anonymous must be true or false.' });
  const feedback = await Feedback.create({ student: req.user._id, category, rating, comment: comment.trim(), anonymous });
  res.status(201).json(feedback);
}));
app.get('/api/student/questions', ...studentOnly, route(async (_req, res) => {
  res.json(await FeedbackQuestion.find().sort({ createdAt: -1 }));
}));
app.get('/api/student/complaints', ...studentOnly, route(async (req, res) => {
  const items = await Complaint.find({ student: req.user._id }).sort({ createdAt: -1 }).limit(limitFrom(req.query.limit));
  res.json(items);
}));
app.post('/api/student/complaints', ...studentOnly, route(async (req, res) => {
  const { subject, category, description } = req.body || {};
  if (typeof subject !== 'string' || subject.trim().length < 2 || subject.trim().length > 150) {
    return res.status(400).json({ message: 'Subject must be between 2 and 150 characters.' });
  }
  if (!validCategory(category)) return res.status(400).json({ message: 'Choose a valid campus area.' });
  if (typeof description !== 'string' || description.trim().length < 10 || description.trim().length > 3000) {
    return res.status(400).json({ message: 'Details must be between 10 and 3,000 characters.' });
  }
  const complaint = await Complaint.create({ student: req.user._id, subject: subject.trim(), category, description: description.trim() });
  res.status(201).json(complaint);
}));
app.patch('/api/student/profile', ...studentOnly, route(async (req, res) => {
  const name = req.body?.name;
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
    return res.status(400).json({ message: 'Name must be between 2 and 100 characters.' });
  }
  req.user.name = name.trim();
  await req.user.save();
  res.json({ user: publicUser(req.user) });
}));

app.get('/api/host/summary', ...hostOnly, route(async (_req, res) => {
  const [feedbackCount, studentCount, average, openComplaints, categoryTotals, monthlyTotals] = await Promise.all([
    Feedback.countDocuments(),
    User.countDocuments({ role: 'student' }),
    Feedback.aggregate([{ $group: { _id: null, value: { $avg: '$rating' } } }]),
    Complaint.countDocuments({ status: { $ne: 'resolved' } }),
    Feedback.aggregate([{ $group: { _id: '$category', count: { $sum: 1 }, averageRating: { $avg: '$rating' } } }]),
    Feedback.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000) } } },
      { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, responses: { $sum: 1 } } },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
  ]);
  const countByCategory = new Map(categoryTotals.map(item => [item._id, item]));
  const date = new Date();
  const trend = Array.from({ length: 6 }, (_v, index) => {
    const monthDate = new Date(date.getFullYear(), date.getMonth() - 5 + index, 1);
    const match = monthlyTotals.find(item => item._id.year === monthDate.getFullYear() && item._id.month === monthDate.getMonth() + 1);
    return { month: monthDate.toLocaleString('en', { month: 'short' }), responses: match?.responses || 0 };
  });
  res.json({
    feedbackCount, studentCount, averageRating: average[0]?.value || 0, openComplaints,
    categories: categories.map(name => ({ name, count: countByCategory.get(name)?.count || 0, averageRating: countByCategory.get(name)?.averageRating || 0 })),
    trend,
  });
}));
app.get('/api/host/feedback', ...hostOnly, route(async (req, res) => {
  const items = await Feedback.find().sort({ createdAt: -1 }).limit(limitFrom(req.query.limit))
    .populate('student', 'name email studentId');
  res.json(items.map(item => {
    const feedback = item.toObject();
    if (feedback.anonymous) delete feedback.student;
    return feedback;
  }));
}));
app.get('/api/host/students', ...hostOnly, route(async (_req, res) => {
  const students = await User.find({ role: 'student' }).sort({ createdAt: -1 }).select('name email studentId createdAt');
  res.json(students);
}));
app.get('/api/host/complaints', ...hostOnly, route(async (req, res) => {
  const items = await Complaint.find().sort({ createdAt: -1 }).limit(limitFrom(req.query.limit))
    .populate('student', 'name email studentId');
  res.json(items);
}));
app.patch('/api/host/complaints/:id', ...hostOnly, route(async (req, res) => {
  const { status } = req.body || {};
  if (!['in progress', 'resolved'].includes(status)) return res.status(400).json({ message: 'Choose a valid complaint status.' });
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid complaint ID.' });
  const complaint = await Complaint.findByIdAndUpdate(req.params.id, { status }, { new: true, runValidators: true });
  if (!complaint) return res.status(404).json({ message: 'Complaint not found.' });
  res.json(complaint);
}));

app.get('/api/host/questions', ...hostOnly, route(async (_req, res) => res.json(await FeedbackQuestion.find().sort({ createdAt: -1 }))));
app.post('/api/host/questions', ...hostOnly, route(async (req, res) => {
  const { text, category } = req.body || {};
  if (typeof text !== 'string' || text.trim().length < 3 || text.trim().length > 250 || !validCategory(category)) {
    return res.status(400).json({ message: 'Enter a question and choose a valid category.' });
  }
  res.status(201).json(await FeedbackQuestion.create({ text: text.trim(), category }));
}));
app.delete('/api/host/questions/:id', ...hostOnly, route(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid question ID.' });
  const result = await FeedbackQuestion.findByIdAndDelete(req.params.id);
  if (!result) return res.status(404).json({ message: 'Question not found.' });
  res.status(204).end();
}));
app.get('/api/host/periods', ...hostOnly, route(async (_req, res) => res.json(await FeedbackPeriod.find().sort({ startDate: -1 }))));
app.post('/api/host/periods', ...hostOnly, route(async (req, res) => {
  const { name, startDate, endDate } = req.body || {};
  const start = new Date(startDate); const end = new Date(endDate);
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100 || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) {
    return res.status(400).json({ message: 'Enter a valid period name and date range.' });
  }
  res.status(201).json(await FeedbackPeriod.create({ name: name.trim(), startDate: start, endDate: end }));
}));
app.delete('/api/host/periods/:id', ...hostOnly, route(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid period ID.' });
  const result = await FeedbackPeriod.findByIdAndDelete(req.params.id);
  if (!result) return res.status(404).json({ message: 'Feedback period not found.' });
  res.status(204).end();
}));
app.get('/api/host/settings', ...hostOnly, route(async (_req, res) => {
  const settings = await Setting.findOneAndUpdate({ key: 'global' }, {}, { upsert: true, new: true, setDefaultsOnInsert: true });
  res.json({ registrationEnabled: settings.registrationEnabled, campusName: settings.campusName });
}));
app.patch('/api/host/settings', ...hostOnly, route(async (req, res) => {
  const updates = {};
  if (typeof req.body?.registrationEnabled === 'boolean') updates.registrationEnabled = req.body.registrationEnabled;
  if (typeof req.body?.campusName === 'string') {
    if (req.body.campusName.trim().length < 2 || req.body.campusName.trim().length > 100) {
      return res.status(400).json({ message: 'Campus name must be between 2 and 100 characters.' });
    }
    updates.campusName = req.body.campusName.trim();
  }
  const settings = await Setting.findOneAndUpdate({ key: 'global' }, { $set: updates }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
  res.json({ registrationEnabled: settings.registrationEnabled, campusName: settings.campusName });
}));

app.use((error, _req, res, _next) => {
  if (error?.name === 'ValidationError') return res.status(400).json({ message: 'Some submitted information is invalid.' });
  if (error?.name === 'CastError') return res.status(400).json({ message: 'Invalid identifier.' });
  console.error(error);
  return res.status(500).json({ message: 'The server could not complete your request.' });
});

async function start() {
  if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('Set JWT_SECRET to a random value of at least 32 characters.');
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI before starting CampusVoice.');
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
  });
  if (process.env.HOST_EMAIL && process.env.HOST_PASSWORD) {
    if (process.env.HOST_PASSWORD.length < 12) throw new Error('HOST_PASSWORD must be at least 12 characters.');
    const email = process.env.HOST_EMAIL.trim().toLowerCase();
    const existing = await User.findOne({ email, role: 'host' });
    if (!existing) {
      const passwordHash = await bcrypt.hash(process.env.HOST_PASSWORD, 12);
      await User.create({ name: process.env.HOST_NAME || 'CampusVoice Administrator', email, passwordHash, role: 'host' });
      console.info(`Provisioned authorized host account: ${email}`);
    }
  }
  console.info('Connected to MongoDB.');
  app.listen(PORT, () => console.info(`CampusVoice API listening on port ${PORT}`));
}

start().catch(error => {
  console.error('CampusVoice could not start:', error.message);
  process.exitCode = 1;
});
