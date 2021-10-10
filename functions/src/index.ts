import * as functions from 'firebase-functions';
import { Storage } from '@google-cloud/storage';
    const gcs = new Storage();
import * as FirebaseAdmin from 'firebase-admin';
    const db = FirebaseAdmin.firestore(FirebaseAdmin.initializeApp());
import { v4 as UUIDv4 } from 'uuid';
import { tmpdir } from 'os';
import { join, dirname } from 'path';

const sharp = require('sharp');
const fs = require('fs-extra')



// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
//
// export const helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });

export const createThumbnail = functions.storage
.object()
.onFinalize(async object => {
    console.log('createThumbnail called!');

    const originalAccessToken = object.metadata?.firebaseStorageDownloadTokens;
    const filePath = object.name;
    const fileName = filePath.split('/').pop();
    
    const bucket = gcs.bucket(object.bucket);
    const bucketDir = dirname(filePath);

    const tmpDir = join(tmpdir(), 'thumbnails');
    const tmpFilePath = join(tmpDir, fileName);


    const thumbnailKey = '-small';

// Infinite loop guard 
    if (fileName.includes(thumbnailKey) || !object.contentType.includes('image')) {
        console.log('Exiting cloud function: createThumbnail');
        return false;
    }

// 0. Save original image URL to item doc
  const originalURLSavePromise = saveURLToItemDoc(fileName, bucket.name, filePath, originalAccessToken, "originalURL");

// 1. Check if exists
    await fs.ensureDir(tmpDir);

// 2. Download image to tmpFilePath
    await bucket.file(filePath).download({
        destination: tmpFilePath
    });

// 3. Resize image saved in tmpFilePath
    const sizes = [200];
    
    const uploadPromises = sizes.map(async size => {
    // Create new filepath for resized images
        const thumbnailName = `${fileName}${thumbnailKey}`;
        const thumbnailPath = join(tmpDir, thumbnailName);
        const newthumbnailPath = join(bucketDir, thumbnailName);

    // Resize
        await sharp(tmpFilePath)
            .resize(size, size)
            .toFile(thumbnailPath);

        const uuid = UUIDv4();
        await bucket.upload(thumbnailPath, {
            destination: newthumbnailPath,
            metadata: {
                contentType: object.contentType,
                metadata: {firebaseStorageDownloadTokens: uuid}
            }
        });

        return saveURLToItemDoc(fileName, bucket.name, newthumbnailPath, uuid, "thumbnailURL");
    });

    await Promise.all([...uploadPromises, originalURLSavePromise]);

// 4. Cleanup
    return fs.remove(tmpDir);
});


function saveURLToItemDoc(itemId: string, bucketName: string, bucketPath: string, token: string, urlName: string) {
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(bucketPath)}?alt=media&token=${token}`;
  return db.doc(`items/${itemId}`).update({[urlName]: url});
}


import algoliasearch from 'algoliasearch';

const algoliaClient = algoliasearch(functions.config().algolia.appid, functions.config().algolia.apikey);
const algoliaIndex = algoliaClient.initIndex('angularapp_dev');
const firestoreCollection = 'items';
const firestoreDoc = `${firestoreCollection}/{uid}`;
const algoliaUpdateTopicID = 'algolia_update';

export const saveCollectionToAlgolia = functions.pubsub.topic(algoliaUpdateTopicID).onPublish(async (message, context) => {

  console.log("EventID: ", context.eventId);

	const algoliaRecords: any[] = [];
	const querySnapshot = await db.collection(firestoreCollection).get();

	querySnapshot.docs.forEach(snapshot => {
		const algoliaObject = algoliaObjectFromFirestoreSnapshot(snapshot);
    if (algoliaObject) {
      algoliaRecords.push(algoliaObject);
    }
  });
	
	algoliaIndex.saveObjects(algoliaRecords)
    .then(() => {
      console.log("Successfully indexed firestore collection 'items' to Algolia.");
    })
    .catch((err) => {
      console.error("Failed to index firestore collection 'items' to Algolia.");
    });
})

export const saveToAlgoliaOnCreate = functions.firestore.document(firestoreDoc).onCreate(async (snapshot, context) => {
  await saveDocumentInAlgolia(snapshot);
});

export const saveToAlgoliaOnUpdate = functions.firestore.document(firestoreDoc).onUpdate(async (change, context) => {
  await saveDocumentInAlgolia(change.after);
});

export const saveToAlgoliaOnDelete = functions.firestore.document(firestoreDoc).onDelete(async (snapshot, context) => {
  await deleteDocumentFromAlgolia(snapshot);
});

async function saveDocumentInAlgolia(snapshot: functions.firestore.QueryDocumentSnapshot) {
  const algoliaObject = algoliaObjectFromFirestoreSnapshot(snapshot);
  if (algoliaObject) {
    await algoliaIndex.saveObject(algoliaObject);
  }
}

async function deleteDocumentFromAlgolia(snapshot: FirebaseFirestore.DocumentSnapshot) {
  if (snapshot.exists) {
      await algoliaIndex.deleteObject(snapshot.id);
  }
}

function algoliaObjectFromFirestoreSnapshot(snapshot: FirebaseFirestore.DocumentSnapshot) {
  if (snapshot.exists) {
    const data = snapshot.data();
    if (data) {
      const record = {
        objectID: snapshot.id,
        id: snapshot.id,
        name: data.name,
        description: data.description,
        userID: data.userID,
        thumbnailURL: data.thumbnailURL,
        likes: data.likes,
        dislikes: data.dislikes,
        dateCreated: data.dateCreated.toMillis()
      };

      return record;
    }
  }

  return null;
}
