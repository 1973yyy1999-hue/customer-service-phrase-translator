@echo off
setlocal
chcp 65001 >nul
set "PYTHONUTF8=1"
pushd "%~dp0" || exit /b 1
where py >nul 2>&1
if not errorlevel 1 (
    py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
    if not errorlevel 1 goto launch_py
)
where python >nul 2>&1
if not errorlevel 1 (
    python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
    if not errorlevel 1 goto launch_python
)
echo API 翻译需要 Python 3.10 或更新版本。
echo 只使用常用语匹配时，请直接打开 客服语气翻译器.html。
pause
popd
exit /b 1

:launch_py
py -3 translation_server.py --open
goto done

:launch_python
python translation_server.py --open

:done
set "RUN_STATUS=%errorlevel%"
if not "%RUN_STATUS%"=="0" pause
popd
exit /b %RUN_STATUS%
