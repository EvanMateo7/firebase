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

    const filePath = object.name;
    const fileName = filePath.split('/').pop();
    
    const bucket = gcs.bucket(object.bucket);
    const bucketDir = dirname(filePath);

    const tmpDir = join(tmpdir(), 'thumbnails');
    const tmpFilePath = join(tmpDir, fileName);


    const thumbnailKey = '-small';

    if (fileName.includes(thumbnailKey) || !object.contentType.includes('image')) {
        console.log('Exiting cloud function: createThumbnail');
        return false;
    }

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

        const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(newthumbnailPath)}?alt=media&token=${uuid}`;

        return db.doc(`items/${fileName}`).update({thumbnailURL: url});

        // return uploadTask.map( next => {
        //     db.doc(`items/${fileName}`).update({thumbnailURL: next.getSignedUrl});
        //     return next;
        // });
    })
    await Promise.all(uploadPromises);

    

// 4. Cleanup
    return fs.remove(tmpDir);
});
