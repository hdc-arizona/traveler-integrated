# Launch traveler-integrated in the background
python3 serve.py &

# Launch jupyter
PORT=8789
SECRET_TOKEN=$(< /dev/urandom tr -dc _A-Z-a-z-0-9 | head -c${1:-32};echo;)
echo
echo "To access the notebook, open this file in a browser copy and paste this URL:"
echo
echo " http://localhost:${PORT}/?token=${SECRET_TOKEN}"
echo
jupyter notebook --ip=0.0.0.0 --port=${PORT} --no-browser --NotebookApp.token="${SECRET_TOKEN}" --allow-root

# One can also create a custom URL
# jupyter notebook --ip=0.0.0.0 --port=${PORT} --no-browser --NotebookApp.custom_display_url="http://localhost:8003"
