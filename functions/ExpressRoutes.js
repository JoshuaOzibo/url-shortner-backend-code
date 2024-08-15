const express = require("express");
const cors = require("cors"); //(cross-original resources sharing)
const { db } = require("../DataBase");
const shortid = require("shortid");
const admin = require("firebase-admin");
const serverless = require("serverless-http");
const {
  getDocs,
  doc,
  query,
  where,
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  getDoc,
} = require("firebase/firestore");

//initializing firebase admin SDK if not already initialized
if (!admin.apps.length) {
  const serviceAccount = require("../ServiceAccount/url-database-5612a-firebase-adminsdk-2kp10-825a6e84b2.json");
  admin.initializeApp({
    //initialize with serviceAccount to have more permissions
    credential: admin.credential.cert(serviceAccount),
  });
}

const app = express();
// Parse JSON bodies (for JSON requests)
app.use(express.json());
app.use(cors());

const router = express.Router();

// // Middleware to check authentication using firebase id token
const checkAuth = async (req, res, next) => {
  const authHeader = req.headers["x-user-id"]; //id from request header i.e: this is coming from the frontend

  if (!authHeader) {
    //send a 404 error
    return res.status(401).send("Unauthorized");
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(authHeader); // verifying the token using firebase admin sdk

    req.user = decodedToken;
    next(); //process to the next middleware or router hansler
  } catch (error) {
    return res.status(401).send("Unauthorized");
  }
};

//function to get current date;
const getCurrentDateFormatted = () => {
  const date = new Date();
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
};

// // Route handler for creating short URLs
router.post("/shortenurl", checkAuth, async (req, res) => {
  const { originalUrl } = req.body; //the exact or original url coming from the frontend component <shortenUrl.tsx />

  const userId = req.user.uid; //get user id from decoded token
  try {
    let urlCode;
    let shortUrl;
    let isUnique = false;

    //loop untill a unique code is generated
    while (!isUnique) {
      urlCode = shortid.generate(); //to generate a unique code
      shortUrl = `https://swift-short.netlify.app/${urlCode}`; //how shortUrl attached with a unique code will look like as a reault in the frontend
      isUnique = true;

      //checking if the generated code is unique across all users
      const usersCollection = collection(db, "users");
      const usersSnapshot = await getDocs(usersCollection);

      for (const userDoc of usersSnapshot.docs) {
        const ownerDataCollection = collection(
          db,
          "users",
          userDoc.id,
          "ownerData"
        );
        const ownerDataQuerySnapshot = await getDocs(
          query(ownerDataCollection, where("urlCode", "==", urlCode))
        );

        if (!ownerDataQuerySnapshot.empty) {
          isUnique = false;
          break;
        }
      }
    }

    //save the originalUrl, shortUrl, unique Code etc... to database using addDoc in firebase;
    await addDoc(collection(db, "users", userId, "ownerData"), {
      originalUrl,
      urlCode,
      shortUrl,
      clicks: 0,
      date: getCurrentDateFormatted(),
    });

    res.status(201).json({ shortUrl }); //this is the result when longUrl is sent from the frontend
  } catch (error) {
    console.error("Error creating short URL:", error);
    res.status(500).send("Internal Server Error");
  }
});

// // Route handler for redirecting based on urlCode
router.get("/:urlCode", async (req, res) => {
  try {
    const { urlCode } = req.params;
    const usersCollection = collection(db, "users");
    const usersSnapshot = await getDocs(usersCollection);
    let originalUrl = null;
    let urlDocRef = null;

    //search for the original url that has a particular urlcode asross all users
    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      console.log(`Checking user: ${userId}`);
      const ownerDataCollection = collection(db, "users", userId, "ownerData");
      const ownerDataSnapshot = await getDocs(ownerDataCollection);

      for (const urlDoc of ownerDataSnapshot.docs) {
        console.log(
          `Checking urlCode: ${urlDoc.data().urlCode} for user: ${userId}`
        );
        if (urlDoc.data().urlCode === urlCode) {
          originalUrl = urlDoc.data().originalUrl;
          console.log(`Match found: ${originalUrl}`);
          urlDocRef = urlDoc.ref;
          break;
        }
      }

      if (originalUrl) break;
    }
    if (originalUrl && urlDocRef) {
      //increment clicks when redirect to the original url
      const urlDocData = (await getDoc(urlDocRef)).data();
      await updateDoc(urlDocRef, {
        clicks: urlDocData.clicks + 1,
      });

      console.log(`Redirecting '${urlCode}' to '${originalUrl}'`);
      res.redirect(originalUrl);
    } else {
      res.status(404).send("URL not found");
    }
  } catch (error) {
    console.error("Error retrieving URL:", error);
    res.status(500).send("Internal Server Error");
  }
});

// //Route handler for fetching a single details
router.get("/details/:urlCode", async (req, res) => {
  try {
    const { urlCode } = req.params; // Extract url code from request parameters
    const usersCollection = collection(db, "users");
    const usersSnapshot = await getDocs(usersCollection);
    let foundUrl = null;

    // Search for the URL details associated with the URL code across all users
    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const ownerDataCollection = collection(db, "users", userId, "ownerData");
      const ownerDataSnapshot = await getDocs(ownerDataCollection);

      for (const urlDoc of ownerDataSnapshot.docs) {
        console.log(
          `Checking urlCode: ${urlDoc.data().urlCode} for user: ${userId}`
        );
        if (urlDoc.data().urlCode === urlCode) {
          foundUrl = urlDoc.data();
          console.log(
            `Match found for details urlCode ${urlCode}: ${foundUrl.originalUrl}`
          );
          break;
        }
      }
      if (foundUrl) break;
    }

    if (foundUrl) {
      res.status(200).json(foundUrl); //return url details as json
    } else {
      res.status(404).send("URL not found"); // return error with code 404 if url is not found
    }
  } catch (error) {
    console.error("Error retrieving URL:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Route handler for deleting a URL based on urlCode
router.delete("/deleteurl/:urlCode", checkAuth, async (req, res) => {
  const userId = req.user.uid; //get user id from decoded token
  const { urlCode } = req.params; // Extract url code from request parameter
  console.log(urlCode);
  try {
    //query firestore for the url with the specified
    const q = query(
      collection(db, "users", userId, "ownerData"),
      where("urlCode", "==", urlCode)
    );
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      res.status(404).send("URL not found");
      return;
    }

    const urlDoc = querySnapshot.docs[0];
    await deleteDoc(doc(db, "users", userId, "ownerData", urlDoc.id)); // delete the url document

    res.status(200).send("URL deleted successfully"); // return success message
  } catch (error) {
    res.status(500).send("Internal Server Error"); //through an error if error occured
  }
});

// //put request to customize url bases on urlCode
router.put("/updateurl/:urlCode", checkAuth, async (req, res) => {
  const { urlCode } = req.params; //Extract urlcode from the request sent from the frontend
  const { newCode } = req.body; // new text or special code generated

  const userId = req.user.uid; // Retrieve the authenticated user's ID from the request

  try {
    const usersCollection = collection(db, "users");
    const userDoc = await getDoc(doc(usersCollection, userId));
    if (!userDoc.exists()) {
      return res.status(404).json({ error: "User not found" });
    }

    const ownerDataCollection = collection(db, "users", userId, "ownerData"); //collection of URLs within their document
    const ownerDataQuerySnapshot = await getDocs(
      query(ownerDataCollection, where("urlCode", "==", urlCode))
    );

    if (ownerDataQuerySnapshot.empty) {
      return res.status(404).json({ error: "URL not found" });
    }

    // Get the first matching document (since there should only be one)
    const urlDoc = ownerDataQuerySnapshot.docs[0];

    // Check if new custom code already exists
    const newCodeQuerySnapshot = await getDocs(
      query(ownerDataCollection, where("urlCode", "==", newCode))
    );

    if (!newCodeQuerySnapshot.empty) {
      return res.status(400).json({ error: "Custom code already exists." });
    }

    // Update the URL code and short URL
    await updateDoc(doc(ownerDataCollection, urlDoc.id), {
      urlCode: newCode,
      shortUrl: `https://swift-short.netlify.app/${newCode}`,
    });

    // Create an object with the updated URL information
    const updatedUrl = {
      ...urlDoc.data(),
      urlCode: newCode,
      shortUrl: `https://swift-short.netlify.app/${newCode}`,
    };

    res.status(200).json(updatedUrl);
  } catch (error) {
    res.status(500).send("Internal Server Error");
  }
});

app.use("/", router);
module.exports.handler = serverless(app);
