const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const fs = require('fs');
const _ = require('lodash');
const md5 = require('md5-file');

var resumableUploadIntermediateState = {};

app.use(bodyParser.json());
app.use('/assets', express.static(`${__dirname}/assets`));
app.use('/bower_components', express.static(`${__dirname}/bower_components`));

app.get('/', function(req, res) {
    res.sendFile(`${__dirname}/index.html`);
});

app.post('/upload', function(req, res) {
    // deliverable this window belongs to
    var fileId = req.headers['file-id'];

    var fileChunk = '';
    req.on('data', (data) => {
        fileChunk += data.toString('binary');
    });

    req.on('end', function() {
        var fileChunks = _.get(resumableUploadIntermediateState, fileId, []);

        fileChunks.push(fileChunk);

        _.set(resumableUploadIntermediateState, fileId, fileChunks);

        return res.sendStatus(201);
    });
});

app.post('/upload/finished/:id', function(req, res) {
    var fileId = req.params['id'];

    var fileName = req.body.fileName || 'default.zip';
    var expectedFileChecksum = req.body.expectedFileChecksum;

    var fileChunks = resumableUploadIntermediateState[fileId];

    var fileContent;

    fileChunks.forEach((chunk) => {
        var chunkBuffer = Buffer.from(chunk, 'binary');

        if (!fileContent) {
            fileContent = chunkBuffer;
        } else {
            fileContent = Buffer.concat([fileContent, chunkBuffer]);
        }
    });

    var saveToDirectory = '/tmp';
    var filePath = `${saveToDirectory}/${fileName}`;

    return fs.writeFile(filePath, fileContent, 'binary', (err) => {
        if (err) {
            return res.status(500).json({
                message: 'Failed to save file to disk.'
            });
        }

        // remove intermediate state
        delete resumableUploadIntermediateState[fileId];

        // generate md5 checksum
        md5(filePath, (err, serverSideChecksum) => {
            if (err) {
                return res.status(500).json({
                    message: 'Failed to generate md5 checksum.'
                });
            }

            // fail fast if the server-side calculated checksum does not equal to the client-side calculated one
            if (serverSideChecksum !== expectedFileChecksum) {
                return res.status(400).json({
                    message: `Server-side checksum (${md5Checksum}) does not match client-side checksum (${expectedFileChecksum})`
                })
            }

            // return success response and (for convenience) server-side checksum to the frontend
            res.status(201).json({
                checksum: serverSideChecksum
            });
        });
    });
});

app.listen(3000, function() {
    console.log('App listening on port 3000...');
});
