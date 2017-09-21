const https = require('https');
const os = require('os');
const path = require('path');
const fs = require('fs');
const async = require('async');
const {unzip} = require('node-minizip');
const {URL} = require('url');

module.exports.check = (callback) => {
  callback = callback || (() =>{});

  const option = {
    hostname: 'api.github.com',
    path: '/repos/sokcuri/TweetDeckPlayer/releases/latest',
    headers: {"User-Agent": "TweetDeckPlayer"}
  };

  https.get(option, (res) => {
    if (res.statusCode !== 200) {
      return callback(new Error("Response returns " + res.statusCode));
    }

    res.setEncoding('utf8');

    let rawdata = '';
    res.on('data', (chunk) => { rawdata += chunk; });

    res.on('end', () => {
      try {
        const release = JSON.parse(rawdata);
        const latest = release.tag_name;
        return callback(null, latest, release);
      } catch (e) {
        return callback(e);
      }
    });

    res.on('error', callback);
  });
};

function getFile (url, tempname, filename, callback) {
  let option = {
    hostname: url.hostname,
    path: url.pathname + url.search + url.hash,
    port: url.port,
    followRedirect: false,
    proxy: process.env.http_proxy || process.env.https_proxy,
    headers: {
      "User-Agent": "TweetDeckPlayer",
      "Accept": "application/octet-stream",
    }
  };

  https.get(option, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && typeof res.headers['location'] !== 'undefined') {
      let redirect = new URL(res.headers['location']);
      return getFile(redirect, tempname, filename, callback);
    }

    let tempfile = fs.createWriteStream(tempname);

    if (res.statusCode !== 200) {
      return callback(new Error("Response returns " + res.statusCode));
    } else {
      res.pipe(tempfile);
    }

    tempfile.on('error', (err) => {
      fs.unlink(tempfile);
      callback(err);
    });
    tempfile.once('close', () => {
      fs.rename(tempname, filename, () => {
        unzip(filename, process.cwd(), (err) => {
          callback(err, filename);
        });
      });
    });
  });
};

module.exports.download = (release, callback) => {
  let target = `TweetDeckPlayer-v${release.tag_name}-${os.platform()}-${os.arch()}.zip`;
  let asset = release.assets.filter((item) => { return item.name == target; });

  if (asset.length == 0) return callback(new Error("Cannot find appropriate asset"));
  asset = asset[0];
  if (asset.state !== 'uploaded') return callback(new Error("Asset does not uploaded"));

  let tempname = path.join(os.tmpdir(), "tmpfile.tmp");
  let filename = path.join(process.cwd(), target);
  let url = new URL(asset.url);

  getFile(url, tempname, filename, callback);
};

function recursiveRename (from, to, callback) {
  fs.readdir(from, (err, list) => {
    if (err) return callback(err);
    async.each(list, (item, done) => {
      let addr = path.join(from, item);
      let target = path.join(to, item);
      let isDir = fs.statSync(addr).isDirectory();

      if (isDir) {
        if (!fs.existsSync(target)) fs.mkdirSync(target);
        recursiveRename(addr, target, done);
      } else {
        fs.rename(addr, target, done);
      }
    }, callback);
  });
};

module.exports.do = (filename, callback) => {
  let from = path.join(path.dirname(filename), path.basename(filename, ".zip"));
  recursiveRename(from, process.cwd(), callback);
};
