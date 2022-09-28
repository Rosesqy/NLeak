FROM ubuntu:22.04

LABEL MAINTAINER "NLeak Team"
LABEL DESCRIPTION "This image is used to create a build environment for NLeak"

RUN apt-get update && apt -y upgrade && apt-get install -y \
    curl \
    rsync \
    vim \
    zip \
    wget \
    git \
    python3-pip \
    net-tools

RUN apt-get update && apt-get install -y \
    software-properties-common \
    npm

RUN npm install npm@latest -g && \
    npm install n -g && \
    n latest

RUN npm install --global yarn

RUN pip3 install mitmproxy

RUN pip3 install websockets

# Install required libraries
RUN apt-get install -y gconf-service libasound2 libatk1.0-0 libcairo2 libcups2 libfontconfig1 libgdk-pixbuf2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libxss1 fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils

# Install Google Chrome
RUN wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
RUN dpkg -i google-chrome-stable_current_amd64.deb; apt-get -fy install

RUN npm install -g http-server

ENTRYPOINT [ "/bin/bash" ]
