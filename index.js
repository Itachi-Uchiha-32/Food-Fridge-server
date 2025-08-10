require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require("firebase-admin");
const serviceAccount = require("./firebase-admin-service-key.json");
const app = express();
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');


const port = process.env.PORT || 3000;
const allowedOrigins = [
  'http://localhost:5173',                  
  'https://assignment-11-90db9.web.app' 
];

app.use(cors({
  origin: function(origin, callback) {
    // allow requests with no origin (like Postman, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

// Firebase Admin Setup
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// MongoDB Setup
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@server-site.fdkwolx.mongodb.net/?retryWrites=true&w=majority&appName=Server-site`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// Middleware to verify Firebase ID token
const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers?.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).send({ message: 'unauthorized access' });
  }

  const token = authHeader.split(' ')[1];
  console.log(token )
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded = decoded;
    next();
  } catch (error) {
    return res.status(401).send({ message: 'unauthorized access' });
  }
};

// Middleware to verify query email matches token
const verifyTokenEmail = (req, res, next) => {
  if (req.query.email && req.query.email !== req.decoded.email) {
    return res.status(403).send({ message: 'forbidden access' });
  }
  next();
};

// Main DB Logic
async function run() {
  //await client.connect();
  const db = client.db('foodExpiryTrackerSystem');
  const foodCollection = db.collection('foods');
  const tipCollection = db.collection('foodTips');
  const labelCollection = db.collection('expiryLabel');
  const notesCollection = db.collection('notes');

  // 
  app.post('/foods', verifyFirebaseToken, async (req, res) => {
    const food = req.body;
    const processedFood = {
      ...food,
      expiryDate: new Date(food.expiryDate),
      addedDate: new Date(food.addedDate),
    };
    const result = await foodCollection.insertOne(processedFood);
    res.send(result);
  });

  // 
  app.get('/foods', verifyFirebaseToken, verifyTokenEmail, async (req, res) => {
    const email = req.query.email;
    const query = email ? { userEmail: email } : {};
    const result = await foodCollection.find(query).toArray();
    res.send(result);
  });

  // 
  app.patch('/foods/:id', verifyFirebaseToken, async (req, res) => {
    const id = req.params.id;
    const filter = { _id: new ObjectId(id) };
    const update = {
      $set: {
        foodTitle: req.body.foodTitle,
        category: req.body.category,
        quantity: req.body.quantity,
        expiryDate: new Date(req.body.expiryDate),
      }
    };

    try {
      const result = await foodCollection.updateOne(filter, update);
      if (result.modifiedCount > 0) {
        res.send({ success: true });
      } else {
        res.status(404).send({ message: "No changes made or item not found." });
      }
    } catch (error) {
      res.status(500).send({ message: "Update failed.", error });
    }
  });

  // 
  app.delete('/foods/:id', verifyFirebaseToken, async (req, res) => {
    const id = req.params.id;
    try {
      const result = await foodCollection.deleteOne({ _id: new ObjectId(id) });
      if (result.deletedCount > 0) {
        res.send({ deletedCount: result.deletedCount });
      } else {
        res.status(404).send({ message: 'Food not found' });
      }
    } catch (error) {
      res.status(500).send({ error: 'Delete failed' });
    }
  });

  app.get('/foods/nearly-expired', async (req, res) => {
    const today = new Date();
    const fiveDaysLater = new Date();
    fiveDaysLater.setDate(today.getDate() + 5);
    const result = await foodCollection.find({
      expiryDate: { $gte: today, $lte: fiveDaysLater }
    }).sort({ expiryDate: 1 }).limit(6).toArray();
    res.send(result);
  });

  app.get('/foods/expired', async (req, res) => {
    const today = new Date();
    const result = await foodCollection.find({
      expiryDate: { $lt: today }
    }).sort({ expiryDate: -1 }).limit(6).toArray();
    res.send(result);
  });

  app.get('/foods/:id', async (req, res) => {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: 'Invalid food ID format' });
    }
    const result = await foodCollection.findOne({ _id: new ObjectId(id) });
    if (!result) return res.status(404).send({ error: 'Food not found' });
    res.send(result);
  });

  // Tips
  app.get('/tips', async (req, res) => {
    const result = await tipCollection.find().toArray();
    res.send(result);
  });

  // Notes
  app.get('/notes/:foodId', async (req, res) => {
    try {
      const notes = await notesCollection.find({ foodId: req.params.foodId }).toArray();
      res.send(notes);
    } catch (err) {
      res.status(500).send({ error: 'Failed to load notes' });
    }
  });

  app.post('/notes', verifyFirebaseToken, async (req, res) => {
    try {
      const { text, foodId, userEmail, postedAt } = req.body;
      if (!text || !foodId || !userEmail || !postedAt) {
        return res.status(400).json({ message: 'Missing required fields' });
      }
      const result = await notesCollection.insertOne({ text, foodId, userEmail, postedAt });
      const insertedNote = await notesCollection.findOne({ _id: result.insertedId });
      res.send(insertedNote);
    } catch (error) {
      res.status(500).json({ error: 'Failed to post note' });
    }
  });

  // Labels
  app.get('/expiryLabel', async (req, res) => {
    const result = await labelCollection.find().toArray();
    res.send(result);
  });
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Food server site server running');
});

app.listen(port, () => {
  console.log('Server is running on port', port);
});
