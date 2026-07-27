#!/bin/bash
# Open Project Folder — opens this project in Finder.
cd "$(dirname "$0")" || exit 1
open .
