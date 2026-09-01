<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Default Filesystem Disk
    |--------------------------------------------------------------------------
    |
    | Here you may specify the default filesystem disk that should be used
    | by the framework. The "local" disk, as well as a variety of cloud
    | based disks are available to your application for file storage.
    |
    */

    'default' => env('FILESYSTEM_DISK', 'local'),

    /*
    |--------------------------------------------------------------------------
    | Filesystem Disks
    |--------------------------------------------------------------------------
    |
    | Below you may configure as many filesystem disks as necessary, and you
    | may even configure multiple disks for the same driver. Examples for
    | most supported storage drivers are configured here for reference.
    |
    | Supported drivers: "local", "ftp", "sftp", "s3"
    |
    */

    'disks' => [

        'local' => [
            'driver' => 'local',
            'root' => storage_path('app/private'),
            'serve' => true,
            'throw' => false,
        ],

        'public' => [
            'driver' => 'local',
            'root' => storage_path('app/public'),
            'url' => env('APP_URL').'/storage',
            'visibility' => 'public',
            'throw' => false,
        ],

        /*
         * The avatars disk — Phase 3c-i Task 8, spec D6. The first and only
         * upload path this port has; before it, this file was stock Laravel.
         *
         * ITS OWN DISK RATHER THAN A PREFIX ON `public`, and the reason is
         * the docroot. docs/HOSTING.md row 6 came back on 2026-09-01 with
         * `symlink()` ALLOWED, so `artisan storage:link` genuinely works —
         * but the survey's own caveat was to confirm the shim docroot
         * serves the link before relying on it, and it does not:
         * deploy/post-deploy.sh:128-134 copies `public/build` and
         * `public/.htaccess` into $PUBLIC_HTML_PATH and nothing else, so
         * under the shim (Task 21's coded default) a `public/storage`
         * symlink is in a directory the web server never reaches. Row 6's
         * own fallback is a filesystem path inside the served docroot, and
         * these two variables are it: point AVATAR_DISK_ROOT at
         * `$PUBLIC_HTML_PATH/storage/avatars` and AVATAR_DISK_URL at the
         * matching address, and the photographs are written where they are
         * already served without a symlink, a sync step, or a deploy hook
         * anybody has to remember.
         *
         * The defaults are the ordinary Laravel ones, so `storage:link` is
         * all that development and the other two docroot options need.
         *
         * PUBLIC-READ, deliberately and with a cost: an avatar URL is
         * guessable by nobody (a UUID) but readable by anyone who has it.
         * That is what makes stripping EXIF a child-safety control rather
         * than a nicety — see App\Support\Members\AvatarImage.
         *
         * `throw => true`, AND IT IS THE ONLY DISK HERE THAT SETS IT. The
         * other three are stock Laravel's `false`, which turns a failed
         * write into a `false` return value — and a false nobody reads is a
         * write that did not happen and nothing that says so. On THIS disk
         * that failure has a name: `AvatarStorage::store()` mints a key from
         * the put, so a silently-failed write records a proposal for an
         * object that does not exist, tells the manager a photograph was
         * proposed, and — on approval — writes a dangling key permanently
         * onto `users.avatar_object`. The likeliest cause is exactly the
         * misconfiguration the paragraphs above warn about: AVATAR_DISK_ROOT
         * pointed somewhere the process cannot write under the shim docroot.
         * A 500 in the log naming an unwritable path is what an operator can
         * act on; a reader repeatedly told their photograph was accepted is
         * not.
         *
         * The one place that must NOT fail loudly is the post-commit delete,
         * and `AvatarStorage::discard()` now says so in code rather than
         * relying on this flag to say it — see its own comment. That is the
         * documented residual (docs/known-gaps.md): an orphaned object costs
         * storage, and turning it into a 500 after a decision has already
         * committed would be strictly worse.
         */
        'avatars' => [
            'driver' => 'local',
            'root' => env('AVATAR_DISK_ROOT', storage_path('app/public/avatars')),
            'url' => env('AVATAR_DISK_URL', env('APP_URL').'/storage/avatars'),
            'visibility' => 'public',
            'throw' => true,
        ],

        's3' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION'),
            'bucket' => env('AWS_BUCKET'),
            'url' => env('AWS_URL'),
            'endpoint' => env('AWS_ENDPOINT'),
            'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', false),
            'throw' => false,
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Symbolic Links
    |--------------------------------------------------------------------------
    |
    | Here you may configure the symbolic links that will be created when the
    | `storage:link` Artisan command is executed. The array keys should be
    | the locations of the links and the values should be their targets.
    |
    */

    'links' => [
        public_path('storage') => storage_path('app/public'),
    ],

];
