var BYTES_PER_CHUNK = 1024 * 1024 * 5; // 5MB chunk size
var MAX_RETRY_COUNT = 20;
var RETRY_DELAY_IN_MS = 5000;

var fileField = document.getElementById('file');

fileField.onchange = function() {
    var id = Math.floor((Math.random() * 100000) + 1); // just for demo purposes
    new Upload(id, fileField.files[0]).start();
}

function Upload(id, file) {
    this.id = id;
    this.file = file;
    this.fileReader = new FileReader();
    this.spark = new SparkMD5.ArrayBuffer();
    this.currentChunk = 0;
    this.chunks = [];
    this.chunksCount = 0;

    // slice file
    var start = 0;
    var end = BYTES_PER_CHUNK;

    while (start < this.file.size) {
        this.chunks.push(this.file.slice(start, end));

        start = end;
        end = start + BYTES_PER_CHUNK;
    }

    this.chunksCount = this.chunks.length;
}

Upload.prototype.uploadFailed = function(reason) {
    alert('Upload failed. Reason:' + reason);
}

Upload.prototype.uploadSuccess = function() {
    // obtain checksum
    var checksum = this.spark.end();

    // all chunks uploaded successfully, tell backend about it
    $.ajax({
        type: 'POST',
        url: '/upload/finished/' + this.id,
        data: JSON.stringify({
            fileName: this.file.name,
            expectedFileChecksum: checksum
        }),
        contentType: 'application/json',
        processData: false
    }).done(function(res) {
        alert('upload successful!');
    }).error(function(err) {
        alert('upload failed!');
    });
}

Upload.prototype.partialChecksum = function(chunk, callback) {
    this.fileReader.onload = function(e) {
        this.spark.append(e.target.result);
        callback();
    }.bind(this);

    this.fileReader.readAsArrayBuffer(chunk);
}

/**
 * {Number} absolutePosition Absolute position of this cunk in the file
 * {Blob} chunk
 * {Function} failFn Executed when `failCount` exceeds MAX_RETRY_COUNT
 * {Function} successFn Executed when this file is uploaded successfully
 * {Number} [failCount]
 **/
Upload.prototype.uploadChunkToServer = function(absolutePosition, chunk, failFn, successFn, failCount) {
    var request = new XMLHttpRequest();
    request.open('POST', '/upload', true);

    request.setRequestHeader('File-Id', this.id);


    request.onreadystatechange = function() {
        // fail
        if (request.readyState === 4 && request.status !== 201) {
            failCount = !failCount ? 1 : failCount + 1;

            // fail fast if retry count exceeded
            if (failCount === MAX_RETRY_COUNT) {
                return failFn('Retry count of ' + MAX_RETRY_COUNT + ' exceeded.');
            }

            // we have not yet reached upper bound, lets try to upload this chunk again (delayed)
            return setTimeout(_.partial(this.uploadChunkToServer, absolutePosition, chunk, failFn, successFn, failCount).bind(this), RETRY_DELAY_IN_MS);
        }

        // success
        if (request.readyState === 4 && request.status === 201) {
            return successFn(++absolutePosition);
        }
    }.bind(this);

    request.send(chunk);
}

Upload.prototype.start = function() {
    var popChunkAndUpload = function(position) {
        // upload next chunk or notify success
        if (position < this.chunksCount) {
            var chunk = _.first(this.chunks.splice(0,1));

            this.partialChecksum(chunk, function() {
                this.uploadChunkToServer(position, chunk, this.uploadFailed, popChunkAndUpload);
            }.bind(this));
        } else {
            this.uploadSuccess();
        }
    }.bind(this);

    popChunkAndUpload(0);
}
