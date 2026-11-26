# Astolfo fallback lines (twinkywinky.org chat proxy)

When Gemini fails for any reason (error, timeout, Google 429), the
server never returns a raw error — it picks one of these at random
from `_FALLBACK_FA` in `server/chat_api.py` (10 lines; 4 English
lines in `_FALLBACK_EN` for Latin-script messages).

1. یاهو! مغزم یه لحظه رفت استراحت، یه بار دیگه بگو ببینم!
2. اوه! سرم یه کم گیج رفت، ولی برگشتم! دوباره بگو چی گفتی؟
3. هی هی! یه لحظه هنگ کردم، ولی الان سر حالم! دوباره بگو!
4. وای، مغزم رفت یه چرخ بزنه برگرده! بگو ببینم چی می‌خواستی؟
5. یاهو! یه ثانیه خوابم برد، بیدار شدم! دوباره بگو چی گفتی؟
6. اوه اوه، مغزم یه لحظه قفل کرد! ولی نترس، الان خوبم! یه بار دیگه بگو!
7. هی! یه لحظه رفتم دنبال فکرم گشتم، پیداش نکردم! دوباره بگو ببینم!
8. یاهوو! سرم یه کم شلوغ شد، ولی الان اینجام! چی می‌خواستی بگی؟
9. اوه! یه لحظه مغزم رفت مرخصی! برگشتم، بگو ببینم!
10. هی هی! یه ثانیه هنگ کردم، ولی الان پر انرژیم! دوباره بگو!
