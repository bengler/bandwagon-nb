require("es6-shim");
var fs = require("fs");
var Uid = require("pebbles-uid");
var url = require('url');
var path = require('path');
var mkdirp = require('mkdirp');
var sanitize = require("sanitize-filename");
var xtend = require("xtend");
var es = require("event-stream");
var request = require("request");
var P = require("bluebird");
var through = require("through2");

var debug = require("debug")('bandwagon-nb');
var buildXML = require("./build-nb-xml");
var backend = require("./backend");

mkdirp('./out', function() {
  es.readArray([2013])
    .pipe(fetchTracksFromYear())
    .pipe(addArtist())
    .pipe(addMeta())
    .pipe(addPublication())
    .pipe(addIdentity())
    .pipe(ensureTargetPath())
    .pipe(ensureAudioFile())
    .pipe(copyFile())
    .pipe(dumpXML())
    // json is now embedded in OtherDocuments field in xml
    //.pipe(dumpJSON())
    .pipe(logSummary())
  ;
});

var unknownArtist = {
  document: {
    name: '<ukjent>' 
  }
};
function fetchTracksFromYear(options) {
  options = options || {};
  var page = 0;
  return through.obj(function (year, enc, callback) {
    debug("Fetching tracks for %d", year);
    var self = this;
    function fetchNext(pagination) {
      return backend.fetchPosts("post.track:apdm.bandwagon." + year + ".*", pagination)
        .then(function (result) {
          page++;
          result.posts.forEach(function (post) {
            self.push({
              year: year,
              track: post
            });
          });
          
          if ((options.pages && options.pages == page) || result.pagination.last_page) {
            return;
          }
          
          return fetchNext({
            offset: result.pagination.offset + result.pagination.limit,
            limit: result.pagination.limit,
            last_page: result.pagination.last_page
          })
        });
    }
    return fetchNext({offset: 0, limit: 25})
      .then(function() {
        debug("Done fetching tracks for %d", year);
        callback(null, null);
      })
      .catch(function(error) {
        debug("Got error while fetching tracks for "+year, error);
        callback(error)
    });
  });
}

function addArtist() {
  return through.obj(function (entry, enc, callback) {
    debug("Adding artist to entry for track %s", entry.track.document.name);
    var artistUid = trackUid2ArtistUid(entry.track.uid).toString();
    backend.fetchPost(artistUid)
      .then(function (artist) {
        gotArtist(artist);
      })
      .catch(function (error) {
        if (error.status == 404) {
          debug("[warning] Artist not found for track %s", entry.track.document.name);
          return gotArtist(unknownArtist);
        }
        callback(error)
      });
    
    function gotArtist(artist) {
      callback(null, xtend(entry, {
        artist: artist
      }))
    }
  });

  function trackUid2ArtistUid(trackUid) {
    var parsedUid = new Uid(trackUid);
    var trackPath = parsedUid.path().toArray();
    return parsedUid
      .klass('post.artist')
      .path(trackPath.slice(0, 2).concat(trackPath[4]).join("."))
      .oid(parsedUid.path().last());
  }
}

function addIdentity() {
  return through.obj(function (entry, enc, callback) {
    debug("Adding identity to entry for track %s", entry.track.document.name);
    var uploadedBy = entry.track.created_by;
    backend.fetchIdentity(uploadedBy)
      .then(function (identity) {
        callback(null, xtend(entry, {
          uploadedBy: identity
        }))
      })
      .catch(function (error) {
        if (error.status == 404) {
          debug("[warning] Identity not found for track %s", entry.track.document.name);
        }
        callback(error)
      });
  });
}

function addPublication() {
  return through.obj(function (entry, enc, callback) {
    debug("Adding publication to entry for track %s", entry.track.document.name);
    var publicationLabel = trackUid2PublicationLabel(entry.track.uid);
    backend.fetchPublication(publicationLabel)
      .then(function (publication) {
        gotPublication(publication);
      })
      .catch(function (error) {
        debug("[warning] Could not fetch publication for track %s (label: %s) ", entry.track.document.name, publicationLabel, error);
        gotPublication({
          label: publicationLabel,
          title: titlecase(publicationLabel)
        });
      });

    function gotPublication(publication) {
      callback(null, xtend(entry, {
        publication: publication
      }));
    }
  });

  function titlecase(str) {
    return str ? str.substring(0, 1).toUpperCase() + str.substring(1) : str 
  }
  function trackUid2PublicationLabel(trackUid) {
    var parsedUid = new Uid(trackUid);
    var trackPath = parsedUid.path().toArray();
    // e.g [ 'apdm', 'bandwagon', '2012', 'inner', 'oa', '445898' ]
    return trackPath.slice(-2)[0];
  }
}

function addMeta() {
  return through.obj(function(entry, enc, callback) {

    debug("Adding metadata to entry for track %s", entry.track.document.name);

    var trackFileUrl = entry.track.document.audio_file_url;
    var localPath = url.parse(trackFileUrl).pathname;
    var cacheFile = path.join(__dirname, 'cache', localPath);
    var targetPath = path.join(__dirname, 'out', ''+entry.year);

    var baseName = generateFileBaseName(entry);
    
    callback(null, xtend(entry, {
      localPath: localPath,
      fileUrl: trackFileUrl,
      targetPath: targetPath,
      cacheFile: cacheFile,
      baseName: baseName
    }));
  });

  // This generates the the basename of the the file as it appears in the export (./out-folder)
  // It is according to the nasjonalbiblioteket-spec.
  function generateFileBaseName(entry) {
    if (entry.artist.document.name.indexOf('_') > 0) {
      debug("[warn] Found underscore in artist name: ", entry.artist.document.name);
    }
    if (entry.track.document.name.indexOf('_') > 0) {
      debug("[warn] Found underscore in track name: ", entry.track.document.name);
    }

    // The format is:
    // Artist_ Song _Mediatype_Mastertype_Samplerate _Bitrate _Revision Number
    return [
      sanitize(entry.artist.document.name.trim()),
      sanitize(entry.track.document.name.trim()),
      'DIS',
      'Amedia',
      '', // ignore samplerate
      '', // ignore bitrate
      'R01'
    ].join("_")
  }
}

function ensureAudioFile() {
  return through.obj(function(entry, enc, callback) {
    fs.exists(entry.cacheFile, function (exists) {
      var cacheFile = entry.cacheFile;
      if (exists) {
        debug(" Cached file %s exists for %s", cacheFile, entry.fileUrl);
        return callback(null, entry)
      }
      mkdirp(path.dirname(cacheFile), function (err) {
        if (err) {
          return callback(err);
        }
        debug(" Downloading %s to %s", entry.fileUrl, cacheFile);
        var req = request(entry.fileUrl)
          .on('response', function(response) {
            if (response.statusCode == 403) {
              var e = new Error("S3 says forbidden while downloading audio file (it means the file was not found)");
              e.status = e.statusCode = 403;
              req.emit('error', e);
            }
          })
          .pipe(fs.createWriteStream(cacheFile+'.tmp'))
          .on('error', function(e) {
            if (e.status == 403) {
              debug('[warning] Audio file missing from s3. Skipping');
              return callback(); // Effectively means filter
            }
            callback(e);
          })
          .on('finish', function() {
            fs.rename(cacheFile+'.tmp', cacheFile, function(err) {
              callback(err, entry)
            });
          });
      })
    });
  });
}

function ensureTargetPath() {
  return through.obj(function(entry, enc, callback) {
    fs.exists(entry.targetPath, function (exists) {
      if (exists) {
        return callback(null, entry);
      }
      mkdirp(entry.targetPath, function (err) {
        err ? callback(err) : callback(null, entry);
      })
    });
  });
}

function copyFile() {
  return through.obj(function(entry, enc, callback) {
    fs.createReadStream(entry.cacheFile)
      .pipe(fs.createWriteStream(path.join(entry.targetPath, entry.baseName + path.extname(entry.cacheFile))))
      .on('finish', function() {
        callback(null, entry);
      })
      .on('error', callback);
  });
}

function dumpJSON() {
  return through.obj(function(entry, enc, callback) {
    var target = path.join(entry.targetPath, entry.baseName + ".json");
    var json = {
      year: entry.year,
      artist: entry.artist.document,
      track: entry.track.document
    };
    fs.writeFile(target, JSON.stringify(entry, null, 2), function(err) {
      callback(err, entry);
    });
  });
}

function dumpXML() {
  return through.obj(function(entry, enc, callback) {
    var xmlContent = buildXML(entry.year, entry);

    var target = path.join(entry.targetPath, entry.baseName + ".xml");
    fs.writeFile(target, xmlContent, function(err) {
      callback(err, entry);
    });
  });
}

function logSummary() {
  var entryCounts = {};
  return through.obj(function(entry, enc, callback) {
    entryCounts[entry.year] = (entryCounts[entry.year] || 0) + 1;
    debug("Done with %s by %s", entry.track.document.name, entry.artist.document.name);
    callback();
  }, function done() {
    Object.keys(entryCounts).forEach(function(year) {
      debug("Done with %d tracks from %d", entryCounts[year], year)
    });
  })
}