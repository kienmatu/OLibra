FROM dunglas/frankenphp:1-php8.4

RUN install-php-extensions pdo_mysql intl zip bcmath gd opcache pcntl

RUN echo "memory_limit = 512M" > /usr/local/etc/php/conf.d/99-memory-limit.ini

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app

ENV SERVER_NAME=:80
