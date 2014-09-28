var fs = require("fs");
var path = require("path");
var exec = require('child_process').exec;
var semver = require('semver-extra');
var gh = require('github-url-to-object');
var npa = require('npm-package-arg');
var async = require('async');
var npm = require('npm');

function getGitTags(repo, cb) {
    var cmd = ["git", "ls-remote", "--tags", repo];
    var matcher = /[0-9a-fA-F]{40}\s+refs\/tags\/(v?(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))/g;
    var tags = [];
    exec(cmd.join(" "), function (error, stdout, stderr) {
        var match;
        if (error !== null) {
            cb(error);
        } else {
            while (match = matcher.exec(stdout)) {
                var tag = match[1];
                if(tags.indexOf(tag) != -1) continue;
                tags.push(tag);
            }
            cb(null, tags);
        }
    });
}

function canUpdate(version) {
    var dep = npa(version);
    switch(dep.type) {
        case "github":
        case "git": 
        case "remote":
            return true;
        default:
            return false;
    }
}

function getUpdateUrl(name, version, basedir, cb) {
    var pkg = JSON.parse(fs.readFileSync(path.join(basedir, 'node_modules', name, 'package.json'), 'utf8'));
    var url = (pkg.repository.url || version).split("#")[0];
    var dep = npa(url);
    var tag_url, install_url;
    switch(dep.type) {
        case "github":
        case "remote":
            var gho = gh(url);
            tag_url = "https://github.com/" + gho.user + "/" + gho.repo;
            install_url = "git://github.com/" + gho.user + "/" + gho.repo;
            break;
        case "git": 
            // parsing abstract git repo url is very complicated
            // we'll just bet on luck
            tag_url = url;
            install_url = url;
            break;
        default:
            cb(new Error("Invalid dependecy type [" + dep.type + "] for `" + name + "`"));
            return;
    }
    getGitTags(tag_url, function(err, tags) {
        if(err) {
            cb(err);
        } else {
            var max = semver.max(tags.filter(semver.valid));
            if(semver.eq(pkg.version, max)) {
                cb(null, null);
            } else {
                cb(null, install_url + "#" + max);
            }
        }
    });
}

function getUpdateUrls(names, basedir, cb) {
    var pkg = JSON.parse(fs.readFileSync(path.join(basedir, 'package.json'), 'utf8'));
    names = names.filter(function(name) {
        return canUpdate(pkg.dependencies[name]);
    });
    async.map(names, function(name, cb) {
        var version = pkg.dependencies[name];
        getUpdateUrl(name, version, basedir, cb);
    }, function(err, results) {
        if(err) {
            cb(err);
        } else {
            cb(null, results.filter(Boolean));
        }
    });
}

function doUpdate(names, basedir, cb) {
    getUpdateUrls(names, basedir, function(err, urls) {
        if(err) {
            cb(err);
        } else {
            npm.load( { loaded: false }, function(err) {
                if(err) {
                    cb(err);
                } else {
                    npm.on('log', console.log.bind(console));
                    if(urls.length > 0) {
                        npm.commands.install(urls, cb);
                    } else {
                        cb();
                    }
                }
            });
        }
    });
}

exports.doUpdate = doUpdate;
exports.getUpdateUrl = getUpdateUrl;
exports.getUpdateUrls = getUpdateUrls;