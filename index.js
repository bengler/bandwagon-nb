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
  es.readArray([2012])
    .pipe(fetchTracksFromYear())
    .pipe(addArtist())
    .pipe(addMeta())
    .pipe(ensureAudioFile())
    .pipe(copyFile())
    .pipe(dumpXML())
    // json is now embedded in OtherDocuments field in xml
    // .pipe(dumpJSON())
    .pipe(logSummary())
  ;
});

function fetchTracksFromYear() {
  return through.obj(function (year, enc, callback) {
    debug("Fetching tracks for %d", year);
    var self = this;
    function fetchNext(pagination) {
      return backend.fetchPosts("post.track:apdm.bandwagon." + year + ".*", pagination)
        .then(function (result) {
          result.posts.forEach(function (post) {
            self.push({
              year: year,
              track: post
            });
          });
          if (!result.pagination.last_page) {
            return fetchNext({
              offset: result.pagination.offset + result.pagination.limit,
              limit: result.pagination.limit,
              last_page: result.pagination.last_page
            })
          }
        });
    }
    return fetchNext({offset: 0, limit: 25})
      .then(function() {
        debug("Done fetching tracks for %d", year);
        callback(null, null);
      })
      .catch(function(error) {
        debug("Done fetching tracks for %d", year);
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
        callback(null, xtend(entry, {
          artist: artist
        }));
      })
      .catch(function (error) {
        callback(error)
      })
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

function addMeta() {
  return through.obj(function(entry, enc, callback) {

    debug("Adding metadata to entry for track %s", entry.track.document.name);

    var localPath = resolveAudioFilePathName(entry.track);
    var fileUrl = resolveAudioFileUrl(entry.track);
    var cacheFile = path.join(__dirname, 'cache', localPath);
    var baseName = generateBaseName(entry);

    callback(null, xtend(entry, {
      localPath: localPath,
      fileUrl: fileUrl,
      cacheFile: cacheFile,
      baseName: baseName
    }));
  });


  function resolveAudioFileUrl(track) {
    return url.resolve(track.document.audio_file + '/', track.document.audio_file_url);
  }

  function resolveAudioFilePathName(track) {
    var fileUrlDirname = urlDirname(track.document.audio_file_url);
    var originalFileName = getOriginalFilename(track.document.audio_file);
    return path.join(url.parse(fileUrlDirname).pathname, originalFileName);
  }

  function generateBaseName(entry) {
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


  function getOriginalFilename(uid) {
    var parsedUid = new Uid(uid);
    var parts = parsedUid.oid().split("-");
    var originalExtension = parts[2];
    var titleSlug = parts.slice(3).join("-");
    return [titleSlug, originalExtension].join(".");
  }
  function urlDirname(_url) {
    var parsed = url.parse(_url);
    parsed.pathname = path.dirname(parsed.pathname);
    return url.format(parsed);
  }


}

function ensureAudioFile() {
  return through.obj(function(entry, enc, callback) {
    fs.exists(entry.cacheFile, function (exists) {
      var cacheFile = entry.cacheFile;
      if (exists) {
        debug(" Cached file %s exists for %s", cacheFile, entry.fileUrl);
      }
      mkdirp(path.dirname(cacheFile), function (err) {
        if (err) {
          return callback(err);
        }
        debug(" Downloading %s to %s", entry.fileUrl, cacheFile);
        request(entry.fileUrl)
          .pipe(fs.createWriteStream(cacheFile))
          .on('error', callback)
          .on('finish', function() {
            callback(null, entry)
          });
      })
    });
  });
}

function copyFile() {
  return through.obj(function(entry, enc, callback) {
    fs.createReadStream(entry.cacheFile)
      .pipe(fs.createWriteStream(__dirname + '/out/' + entry.baseName + path.extname(entry.cacheFile)))
      .on('finish', function() {
        callback(null, entry);
      })
      .on('error', callback);
  });
}

function dumpJSON() {
  return through.obj(function(entry, enc, callback) {
    var target = __dirname + '/out/' + entry.baseName + ".txt";
    var json = {
      year: entry.year,
      artist: entry.artist.document,
      track: entry.track.document
    };
    fs.writeFile(target, JSON.stringify(json, null, 2), function(err) {
      callback(err, entry);
    });
  });
}

function dumpXML() {
  return through.obj(function(entry, enc, callback) {
    var xmlContent = buildXML(entry.year, {
      track: entry.track,
      artist: entry.artist
    });

    var target = __dirname + '/out/' + entry.baseName + ".xml";
    fs.writeFile(target, xmlContent, function(err) {
      callback(err, entry);
    });
  });
}

function logSummary() {
  var entryCounts = {};
  return through.obj(function(entry, enc, callback) {
    entryCounts[entry.year] = (entryCounts[entry.year] || 0) + 1;
    callback();
  }, function done() {
    Object.keys(entryCounts).forEach(function(year) {
      debug("Done with %d tracks from %d", entryCounts[year], year)
    });
  })
}