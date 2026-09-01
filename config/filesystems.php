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
         */
        'avatars' => [
            'driver' => 'local',
            'root' => env('AVATAR_DISK_ROOT', storage_path('app/public/avatars')),
            'url' => env('AVATAR_DISK_URL', env('APP_URL').'/storage/avatars'),
            'visibility' => 'public',
            'throw' => false,
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
