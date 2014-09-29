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
        if (error !== null) {
            return cb(error);
        }
        var match;
        while (match = matcher.exec(stdout)) {
            var tag = match[1];
            if(tags.indexOf(tag) != -1) continue;
            tags.push(tag);
        }
        return cb(null, tags);
    });
}

function asyncReadFile(path, cb) { // path -> content
    fs.readFile(path, { encoding: 'utf8' }, cb);
}

function asyncParseJSON(content, cb) { // content -> pkg
    try {
        var pkg = JSON.parse(content);
    } catch(err) {
        return cb(err);
    }
    return cb(null, pkg);
}

function getUpdateUrl(dep, cb) {
    async.seq(
        function(cb) {
            var pkgpath = path.join(dep.basedir, 'node_modules', dep.name, 'package.json');
            return cb(null, pkgpath);
        },
        asyncReadFile,
        asyncParseJSON,
        function(pkg, cb) {
            pkg.repository = pkg.repository || {};
            pkg.repository.url = pkg.repository.url || dep.spec.split("#")[0];
            return cb(null, pkg);
        },
        function(pkg, cb) {
            var url = pkg.repository.url;
            var gho = gh(url) || gh(dep.spec.split("#")[0]);
            if(gho !== null) {
                pkg.urls = {
                    tag: "https://github.com/" + gho.user + "/" + gho.repo,
                    install: "git://github.com/" + gho.user + "/" + gho.repo
                };                 
            } else {
                pkg.urls = {
                    tag: url,
                    install: url
                };
            }
            return cb(null, pkg);
        },
        function(pkg, cb) {
            getGitTags(pkg.urls.tag, function(err, tags) {
                if(err) {
                    return cb(err);
                }
                var max = semver.max(tags.filter(semver.valid));
                if(semver.eq(pkg.version, max)) {
                    return cb(null, null);
                } else {
                    return cb(null, pkg.urls.install + "#" + max);
                }
            });  
        }
    )(cb);
}

function getUpdateUrls(names, basedir, cb) {
    async.seq(
        function(cb) {
            var pkgpath = path.join(basedir, 'package.json');
            return cb(null, pkgpath);
        },
        asyncReadFile,
        asyncParseJSON,
        function(pkg, cb) { // pkg -> name@version
            async.map(names, function(name, cb) { 
                if(pkg.dependencies !== undefined) {
                    if(name in pkg.dependencies) {
                        return cb(null, name + "@" + pkg.dependencies[name]);
                    }
                }
                if(pkg.devDependencies !== undefined) {
                    if(name in pkg.devDependencies) {
                        return cb(null, name + "@" + pkg.devDependencies[name]);
                    }
                }
                return cb(new Error("Can't find dependency `" + name + "`"));
            }, cb);
        },
        function(deps, cb) { // name@version -> npa
            async.map(deps, function(dep, cb) {
                var analyzed = npa(dep);
                analyzed.basedir = basedir;
                return cb(null, analyzed);
            }, cb);
        },
        function(deps, cb) {
            async.filter(deps, function(dep, cb) {
                switch(dep.type) {
                    case "github":
                    case "git": 
                        return cb(true);
                }
                return cb(false);
            }, function(filtered) {
                return cb(null, filtered);
            });
        },
        function(deps, cb) {
            async.map(deps, function(dep, cb) {
                getUpdateUrl(dep, cb);
            }, cb);
        },
        function(urls, cb) {
            async.filter(urls, function(url, cb) {
                return cb(url !== null);
            }, function(filtered) {
                return cb(null, filtered);
            });
        }
    )(cb);
}

function update(names, basedir, cb) {
    getUpdateUrls(names, basedir, function(err, urls) {
        if(err) {
            return cb(err);
        }
        npm.load( { loaded: false }, function(err) {
            if(err) {
                return cb(err);
            }
            npm.on('log', console.log.bind(console));
            if(urls.length > 0) {
                npm.commands.install(urls, cb);
            } else {
                return cb();
            }
        });
    });
}

module.exports = update;
module.exports.getUpdateUrl = getUpdateUrl;
module.exports.getUpdateUrls = getUpdateUrls;