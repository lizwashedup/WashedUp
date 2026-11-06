from pathlib import Path
import subprocess, plistlib, hashlib, json

import argparse
parser = argparse.ArgumentParser(description='Prepare a separate Release simulator app copy for native lifecycle XCTest.')
parser.add_argument('--app', type=Path, required=True, help='Completed arm64 Release simulator .app')
parser.add_argument('--binary-sha256', required=True, help='Expected SHA256 of the reviewed app executable')
parser.add_argument('--output', type=Path, required=True, help='New evidence directory; must not exist')
args = parser.parse_args()
app = args.app.resolve(strict=True)
info = plistlib.loads((app / 'Info.plist').read_bytes())
assert info.get('DTPlatformName') == 'iphonesimulator', 'Only simulator artifacts are accepted'
assert info.get('CFBundleIdentifier') == 'com.washedup.app', 'Unexpected app identity'
assert hashlib.sha256((app / info['CFBundleExecutable']).read_bytes()).hexdigest() == args.binary_sha256, 'Unexpected app executable'
t = args.output.resolve()
assert not t.exists(), 'Preserve earlier evidence; use a new directory'
t.mkdir(parents=True)
h = t / 'WashedUp.app'
subprocess.run(['cp', '-cR', str(app), str(h)], check=True)
input_hashes = {}
for source in app.rglob('*'):
    if source.is_file():
        relative = source.relative_to(app)
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        assert hashlib.sha256((h / relative).read_bytes()).hexdigest() == digest, str(relative)
        input_hashes[str(relative)] = digest
(t / 'input-app-files.json').write_text(json.dumps(input_hashes, indent=2) + '\n')
source_directory = Path(__file__).resolve().parents[2] / 'qa/native/screen-stack'
b = h / 'PlugIns/ScreenStackLifecycleTests.xctest'
b.mkdir(parents=True)
sdk = subprocess.check_output(['xcrun', '--sdk', 'iphonesimulator', '--show-sdk-path'], text=True).strip()
dev = subprocess.check_output(['xcode-select', '-p'], text=True).strip()
fw = dev + '/Platforms/iPhoneSimulator.platform/Developer/Library/Frameworks'
sources = [source_directory / name for name in ['ScreenStackLifecycleTests.m', 'ScreenStackRetirementTests.m', 'ScreenStackNavigationRetirementTests.m', 'ScreenStackActiveNavigationTests.m']]
subprocess.run(['xcrun', 'clang', '-target', 'arm64-apple-ios17.0-simulator', '-isysroot', sdk,
               '-fobjc-arc', '-fmodules', '-bundle', '-F' + fw, '-framework', 'XCTest',
               '-framework', 'UIKit', '-framework', 'Foundation', '-Wl,-rpath,' + fw,
               *map(str, sources), '-o', str(b / 'ScreenStackLifecycleTests')], check=True)
(b / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleExecutable':'ScreenStackLifecycleTests',
    'CFBundleIdentifier':'app.washedup.tests.ScreenStackLifecycleTests', 'CFBundleName':'ScreenStackLifecycleTests',
    'CFBundlePackageType':'BNDL', 'CFBundleVersion':'1', 'CFBundleShortVersionString':'1.0'}))
for name in ['XCTest.framework', 'XCTestCore.framework', 'XCTestSupport.framework', 'XCUIAutomation.framework', 'XCUnit.framework', 'Testing.framework']:
    src = Path(fw) / name
    if not src.exists(): src = Path(dev) / 'Platforms/iPhoneSimulator.platform/Developer/Library/PrivateFrameworks' / name
    if src.exists(): subprocess.run(['cp', '-cR', str(src), str(h / 'Frameworks' / name)], check=True)
x = {'TestConfigurations':[{'Name':'RetirementExperiment', 'IsEnabled':True, 'TestTargets':[{
    'BlueprintName':'ScreenStackLifecycleTests','TestBundlePath':str(b),'TestHostPath':str(h),
    'TestHostBundleIdentifier':'com.washedup.app','IsAppHostedTestBundle':True,'IsUITestBundle':False,
    'TestingEnvironmentVariables':{'DYLD_INSERT_LIBRARIES':dev+'/Platforms/iPhoneSimulator.platform/Developer/usr/lib/libXCTestBundleInject.dylib',
      'DYLD_FRAMEWORK_PATH':fw,'DYLD_LIBRARY_PATH':dev+'/Platforms/iPhoneSimulator.platform/Developer/usr/lib'},
    'DependentProductPaths':[str(h),str(b)],'SystemAttachmentLifetime':'keepNever','UserAttachmentLifetime':'keepNever'
}]}], '__xctestrun_metadata__':{'FormatVersion':2}}
(t / 'screen-stack.xctestrun').write_bytes(plistlib.dumps(x))
(h.parent / 'test-sources.json').write_text(json.dumps({str(s):hashlib.sha256(s.read_bytes()).hexdigest() for s in sources},indent=2)+'\n')
for source in sources: (h.parent / source.name).write_bytes(source.read_bytes())
print('Prepared separate native retirement experiment test host')
