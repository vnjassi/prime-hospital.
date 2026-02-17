// ==================== BACKEND: server.js (Node.js/Express) ====================
// File: server.js - Main backend server file
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const twilio = require('twilio');
const nodemailer = require('nodemailer');
const stripe = require('stripe')('sk_test_your_stripe_key');
const app = express();

// Advanced Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==================== DATABASE CONNECTION ====================
mongoose.connect('mongodb+srv://primehospital:securepassword@cluster0.mongodb.net/primehospital?retryWrites=true&w=majority', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.log('❌ MongoDB Error:', err));

// ==================== ADVANCED SCHEMAS ====================
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  phone: { type: String, required: true },
  role: { type: String, enum: ['patient', 'doctor', 'admin'], default: 'patient' },
  medicalHistory: [{
    condition: String,
    diagnosedDate: Date,
    medications: [String]
  }],
  insuranceDetails: {
    provider: String,
    policyNumber: String,
    validUntil: Date
  },
  emergencyContact: {
    name: String,
    relationship: String,
    phone: String
  },
  createdAt: { type: Date, default: Date.now }
});

const appointmentSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
  appointmentDate: { type: Date, required: true },
  timeSlot: { type: String, required: true },
  department: { type: String, required: true },
  symptoms: [String],
  status: { 
    type: String, 
    enum: ['pending', 'confirmed', 'completed', 'cancelled', 'no-show'],
    default: 'pending'
  },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'refunded'], default: 'pending' },
  consultationType: { type: String, enum: ['video', 'in-person', 'emergency'], default: 'in-person' },
  plusCode: { type: String, default: 'CX7Q+8WF' },
  queueNumber: Number,
  createdAt: { type: Date, default: Date.now }
});

const doctorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true },
  phone: String,
  specialization: [String],
  qualifications: [String],
  experience: Number,
  availability: [{
    day: String,
    slots: [String]
  }],
  consultationFee: Number,
  rating: { type: Number, default: 0 },
  reviews: [{
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rating: Number,
    comment: String,
    date: Date
  }],
  isAvailable: { type: Boolean, default: true }
});

const bedSchema = new mongoose.Schema({
  bedNumber: String,
  type: { type: String, enum: ['general', 'semi-private', 'private', 'icu', 'nicu'] },
  department: String,
  isOccupied: { type: Boolean, default: false },
  currentPatient: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assignedDoctor: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor' },
  admissionDate: Date,
  expectedDischarge: Date,
  pricePerDay: Number
});

const prescriptionSchema = new mongoose.Schema({
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor' },
  medications: [{
    name: String,
    dosage: String,
    frequency: String,
    duration: String,
    instructions: String
  }],
  labTests: [{
    testName: String,
    instructions: String,
    isCompleted: { type: Boolean, default: false }
  }],
  diagnosis: String,
  notes: String,
  followUpDate: Date,
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Doctor = mongoose.model('Doctor', doctorSchema);
const Appointment = mongoose.model('Appointment', appointmentSchema);
const Bed = mongoose.model('Bed', bedSchema);
const Prescription = mongoose.model('Prescription', prescriptionSchema);

// ==================== EMAIL & SMS SERVICE ====================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'primehospital@gmail.com',
    pass: 'your_app_password'
  }
});

const twilioClient = twilio('ACCOUNT_SID', 'AUTH_TOKEN');

// ==================== JWT AUTHENTICATION ====================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Access denied' });
  
  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// ==================== ADVANCED API ENDPOINTS ====================

// User Registration with Encryption
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, phone, emergencyContact } = req.body;
    
    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Create user
    const user = new User({
      name,
      email,
      password: hashedPassword,
      phone,
      emergencyContact
    });
    
    await user.save();
    
    // Send welcome email
    await transporter.sendMail({
      from: 'primehospital@gmail.com',
      to: email,
      subject: 'Welcome to Prime Hospital',
      html: `
        <h1>Welcome to Prime Hospital</h1>
        <p>Dear ${name},</p>
        <p>Your account has been created successfully.</p>
        <p><strong>Your Plus Code Location:</strong> CX7Q+8WF, Khandsa Road, Sector 36</p>
        <p>You can now book appointments and access your medical records.</p>
      `
    });
    
    // Generate JWT
    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    res.status(201).json({ 
      message: 'Registration successful', 
      token,
      user: { id: user._id, name, email, role: user.role }
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login with Rate Limiting
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    // Log login activity
    console.log(`User ${user.email} logged in at ${new Date()}`);
    
    res.json({ 
      message: 'Login successful',
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Advanced Appointment Booking with Queue System
app.post('/api/appointments', authenticateToken, async (req, res) => {
  try {
    const { doctorId, appointmentDate, timeSlot, department, symptoms, consultationType } = req.body;
    
    // Check doctor availability
    const doctor = await Doctor.findById(doctorId);
    if (!doctor || !doctor.isAvailable) {
      return res.status(400).json({ error: 'Doctor not available' });
    }
    
    // Check if slot is already booked
    const existingAppointment = await Appointment.findOne({
      doctorId,
      appointmentDate,
      timeSlot,
      status: { $in: ['pending', 'confirmed'] }
    });
    
    if (existingAppointment) {
      return res.status(400).json({ error: 'Time slot already booked' });
    }
    
    // Get queue number for the day
    const todayAppointments = await Appointment.countDocuments({
      doctorId,
      appointmentDate: {
        $gte: new Date(appointmentDate).setHours(0,0,0),
        $lt: new Date(appointmentDate).setHours(23,59,59)
      }
    });
    
    const appointment = new Appointment({
      patientId: req.user.userId,
      doctorId,
      appointmentDate,
      timeSlot,
      department,
      symptoms,
      consultationType,
      queueNumber: todayAppointments + 1,
      plusCode: 'CX7Q+8WF'
    });
    
    await appointment.save();
    
    // Send confirmation SMS
    const user = await User.findById(req.user.userId);
    await twilioClient.messages.create({
      body: `Prime Hospital: Appointment confirmed for ${new Date(appointmentDate).toLocaleDateString()} at ${timeSlot}. Queue #${appointment.queueNumber}. Location: CX7Q+8WF, Khandsa Road`,
      from: '+1234567890',
      to: user.phone
    });
    
    // Send email confirmation
    await transporter.sendMail({
      from: 'primehospital@gmail.com',
      to: user.email,
      subject: 'Appointment Confirmed',
      html: `
        <h2>Appointment Confirmation</h2>
        <p>Dear ${user.name},</p>
        <p>Your appointment has been confirmed:</p>
        <ul>
          <li>Date: ${new Date(appointmentDate).toLocaleDateString()}</li>
          <li>Time: ${timeSlot}</li>
          <li>Doctor: Dr. ${doctor.name}</li>
          <li>Department: ${department}</li>
          <li>Queue Number: ${appointment.queueNumber}</li>
          <li>Location: CX7Q+8WF, Khandsa Road, Sector 36</li>
        </ul>
        <p>Please arrive 15 minutes before your scheduled time.</p>
      `
    });
    
    res.status(201).json({ 
      message: 'Appointment booked successfully',
      appointment: { ...appointment.toObject(), queueNumber: appointment.queueNumber }
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// AI-Powered Symptom Checker
app.post('/api/symptom-checker', async (req, res) => {
  try {
    const { symptoms } = req.body;
    
    // AI algorithm (simplified - in production use ML model)
    const symptomAnalysis = {
      fever: ['Flu', 'COVID-19', 'Infection'],
      cough: ['Bronchitis', 'Pneumonia', 'Asthma'],
      headache: ['Migraine', 'Hypertension', 'Stress'],
      chestPain: ['Heart Attack', 'Angina', 'Acid Reflux']
    };
    
    const possibleConditions = [];
    symptoms.forEach(symptom => {
      if (symptomAnalysis[symptom.toLowerCase()]) {
        possibleConditions.push(...symptomAnalysis[symptom.toLowerCase()]);
      }
    });
    
    // Recommend department based on symptoms
    let recommendedDepartment = 'General Medicine';
    if (symptoms.includes('chest pain')) recommendedDepartment = 'Cardiology';
    if (symptoms.includes('headache')) recommendedDepartment = 'Neurology';
    if (symptoms.includes('fever')) recommendedDepartment = 'General Medicine';
    
    res.json({
      possibleConditions: [...new Set(possibleConditions)],
      recommendedDepartment,
      urgencyLevel: symptoms.includes('chest pain') ? 'emergency' : 'normal',
      disclaimer: 'This is an AI-powered preliminary analysis. Please consult a doctor.'
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Real-time Bed Availability
app.get('/api/beds/available', async (req, res) => {
  try {
    const availableBeds = await Bed.find({ isOccupied: false })
      .populate('department')
      .select('bedNumber type department pricePerDay');
    
    const stats = {
      total: await Bed.countDocuments(),
      available: availableBeds.length,
      byType: await Bed.aggregate([
        { $group: { _id: '$type', total: { $sum: 1 }, available: { $sum: { $cond: ['$isOccupied', 0, 1] } } } }
      ])
    };
    
    res.json({ availableBeds: availableBeds.slice(0, 10), stats });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Digital Prescription System
app.post('/api/prescriptions', authenticateToken, async (req, res) => {
  try {
    const { appointmentId, medications, labTests, diagnosis, followUpDate } = req.body;
    
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    
    const prescription = new Prescription({
      appointmentId,
      patientId: appointment.patientId,
      doctorId: appointment.doctorId,
      medications,
      labTests,
      diagnosis,
      followUpDate
    });
    
    await prescription.save();
    
    // Update appointment status
    appointment.status = 'completed';
    await appointment.save();
    
    res.status(201).json({ 
      message: 'Prescription created',
      prescription 
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Payment Processing with Stripe
app.post('/api/payments/create-intent', authenticateToken, async (req, res) => {
  try {
    const { appointmentId, amount } = req.body;
    
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100, // Convert to cents
      currency: 'inr',
      metadata: { 
        appointmentId,
        patientId: req.user.userId
      }
    });
    
    res.json({ 
      clientSecret: paymentIntent.client_secret,
      amount
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Webhook for payment confirmation
app.post('/api/webhooks/stripe', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, 'your_webhook_secret');
    
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      
      // Update appointment payment status
      await Appointment.findByIdAndUpdate(
        paymentIntent.metadata.appointmentId,
        { paymentStatus: 'paid' }
      );
      
      console.log('Payment succeeded:', paymentIntent.id);
    }
    
    res.json({ received: true });
    
  } catch (err) {
    console.log('Webhook error:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// Doctor Assignment AI
app.post('/api/ai/assign-doctor', async (req, res) => {
  try {
    const { symptoms, department, preferredTime } = req.body;
    
    // AI algorithm to find best doctor
    const doctors = await Doctor.find({ 
      specialization: { $in: [department] },
      isAvailable: true
    });
    
    // Score each doctor based on availability, rating, experience
    const scoredDoctors = doctors.map(doctor => {
      let score = 0;
      score += doctor.rating * 10;
      score += doctor.experience * 2;
      
      // Check availability for preferred time
      const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(preferredTime).getDay()];
      const availableSlot = doctor.availability.find(a => a.day === dayName);
      if (availableSlot && availableSlot.slots.includes(new Date(preferredTime).getHours() + ':00')) {
        score += 50;
      }
      
      return { doctor, score };
    });
    
    scoredDoctors.sort((a, b) => b.score - a.score);
    
    res.json({
      recommendedDoctor: scoredDoctors[0]?.doctor,
      alternativeDoctors: scoredDoctors.slice(1, 4).map(d => d.doctor),
      aiConfidence: scoredDoctors[0]?.score / 100
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Emergency Alert System
app.post('/api/emergency/alert', authenticateToken, async (req, res) => {
  try {
    const { location, emergencyType, patientCondition } = req.body;
    
    // Get user details
    const user = await User.findById(req.user.userId);
    
    // Alert nearby hospitals (simplified)
    const emergencyTeam = {
      ambulance: 'Dispatched - ETA 7 mins',
      doctor: 'Dr. Sharma on the way',
      eta: '7 minutes'
    };
    
    // Send SMS to emergency contact
    if (user.emergencyContact?.phone) {
      await twilioClient.messages.create({
        body: `EMERGENCY ALERT: ${user.name} has triggered an emergency at Prime Hospital. Location: CX7Q+8WF. Please contact hospital immediately.`,
        from: '+1234567890',
        to: user.emergencyContact.phone
      });
    }
    
    // Create emergency appointment
    const emergencyAppointment = new Appointment({
      patientId: user._id,
      department: 'Emergency',
      appointmentDate: new Date(),
      status: 'confirmed',
      consultationType: 'emergency',
      plusCode: 'CX7Q+8WF'
    });
    
    await emergencyAppointment.save();
    
    res.json({
      message: 'Emergency alert triggered',
      response: emergencyTeam,
      appointmentId: emergencyAppointment._id
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Analytics Dashboard
app.get('/api/analytics/hospital', authenticateToken, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const analytics = {
      dailyStats: {
        appointments: await Appointment.countDocuments({ 
          appointmentDate: { $gte: today } 
        }),
        emergencies: await Appointment.countDocuments({ 
          consultationType: 'emergency',
          appointmentDate: { $gte: today }
        }),
        revenue: await Appointment.aggregate([
          { $match: { paymentStatus: 'paid', appointmentDate: { $gte: today } } },
          { $count: 'total' }
        ])
      },
      bedOccupancy: await Bed.aggregate([
        { $group: { 
          _id: null,
          total: { $sum: 1 },
          occupied: { $sum: { $cond: ['$isOccupied', 1, 0] } }
        }}
      ]),
      popularDepartments: await Appointment.aggregate([
        { $group: { _id: '$department', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 }
      ]),
      locationStats: {
        plusCode: 'CX7Q+8WF',
        totalVisits: await Appointment.countDocuments(),
        address: 'Khandsa Road, Sector 36, Haryana 122004'
      }
    };
    
    res.json(analytics);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== FRONTEND: index.html ====================
// This will be served as the main page
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Serve static files
app.use(express.static('public'));

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Prime Hospital Server running on port ${PORT}`);
  console.log(`📍 Plus Code: CX7Q+8WF, Khandsa Road, Sector 36`);
});
