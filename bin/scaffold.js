var Cli = require('nested-yargs');
var Git = require('nodegit');
var Bluebird = require('bluebird');
var Path = require('path');
var Rimraf = require('rimraf');
var Colors = require('colors');
var WriteFile = Bluebird.promisify(require('fs').writeFile);
var ExecFile = Bluebird.promisify(require('child_process').execFile);
var JsdParse = require('comment-parser');
var ParseHash = require('./utils/parseHash.js');
var GetTaskCfg = require('./utils/getTaskConfig');
var WtCreate = require('./create');
var Webtask  = require('../');

module.exports = Cli.createCommand('scaffold', 'download webtask templates', {
    params: '[webtask] [name]',
    options: {
        profile: {
            alias: 'p',
            description: 'name of the webtask profile to use',
            'default': 'default',
            type: 'string',
        },
        param: {
            alias: 'm',
            description: 'nonsecret param(s) to provide to code at runtime',
            type: 'string',
        },
        secret: {
            alias: 's',
            description: 'secret(s) to provide to code at runtime',
            type: 'string',
        },
    },
    handler: handleScaffold,
});

var REPO_URL = 'https://github.com/auth0/wt-cli';
var SAMPLE_DIR = 'sample-webtasks';

function handleScaffold(argv) {
    if(argv.param)
        ParseHash(argv, 'param');

    if(argv.secret)
        ParseHash(argv, 'secret');

    Git.Clone(REPO_URL, '.tmp')
        .then(function (repo) {
            return repo.getBranchCommit('master');
        })
        .then(function (commit) {
            if(!argv.params.webtask)
                return listScaffolds(commit);

            var path = SAMPLE_DIR +
                '/' +
                argv.params.webtask +
                (argv.params.webtask.match(/.js$/) ? '' : '.js');

            return scaffoldFrom(argv, commit, path);
        })
        .then(cleanup)
        .catch(function (e) {
            if(e.message === '\'.tmp\' exists and is not an empty directory') {
                cleanup();

                return handleScaffold(argv);
            }
            console.error(e);
            cleanup();
        });
}

function listScaffolds(commit) {
    console.log('Available webtasks:'.green.bold);

    return commit
      .getTree()
      .then(function (tree) {
          return tree.getEntry(SAMPLE_DIR);
      })
      .then(function (entry) {
          return entry.getTree();
      })
      .then(function (tree) {
          var entries = tree.entries()
              .filter(function (entry) {
                  return Path.extname(entry.toString()) === '.js';
              });

          var blobs = entries
              .map(function (entry) {
                  return entry.getBlob();
              });

          var names = entries
              .map(function (entry) {
                  return Path.basename(entry.toString(), '.js');
              });

          return Bluebird.all(blobs)
              .map(function (blob, index) {
                  var name = names[index];
                  var jsdoc = JsdParse(blob.toString());

                  return {
                      name: name,
                      description: jsdoc[0] ? jsdoc[0].description : 'no description.'
                  };
              });
      })
      .then(function (scaffolds) {
          scaffolds
              .forEach(function (scaffold) {
                  console.log(scaffold.name.bold.white + ':', scaffold.description.grey);
              });
      });
}

function scaffoldFrom(argv, commit, path) {
    var filename = argv.params.name ? (argv.params.name + '.js') : 'webtask.js';

    return commit.getEntry(path)
        .then(function (entry) {
            return entry.getBlob();
        })
        .then(function (blob) {
            return WriteFile(filename, blob.toString())
                .then(function () {
                    return blob;
                });
        })
        .then(function (blob) {
            return GetTaskCfg(argv, blob.toString());
        })
        .then(function (cfg) {
            var create_args = [
                'create',
                filename,
                '-n',
                argv.params.name || Path.basename(path, '.js'),
                '-p',
                argv.profile
            ];

            if(cfg.param)
                addArgumentsTo(create_args, cfg.param, '--param');

            if(cfg.secret)
                addArgumentsTo(create_args, cfg.secret, '--secret');

            return ExecFile(__dirname + '/wt', create_args);
        })
        .then(function (output) {
            var url = output[0].slice(0, -1);

            console.log('Scaffold written to'.blue, filename.bold.green);
            console.log('Scaffold deployed to'.blue, url.bold.green)
        })
        .catch(function (e) {
            if(e.message.match('does not exist')) {
                console.error('Requested webtask %s does not exist.\n'.red, Path.basename(path));

                return listScaffolds(commit);
            }

            throw e;
        });
}

function cleanup() {
    Rimraf.sync('.tmp');
}

function addArgumentsTo(args, obj, type) {
    Object.keys(obj)
        .forEach(function (key) {
            var hash = [key, obj[key]].join('=');

            args.push(type, hash);
        });
}
