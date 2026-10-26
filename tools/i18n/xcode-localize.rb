# tools/i18n/xcode-localize.rb
# Registers ios/Drift/<code>.lproj/InfoPlist.strings with the Drift target as
# one localized "InfoPlist.strings" variant group, and adds each code to the
# project's knownRegions. Idempotent. Run with CocoaPods' bundled gems:
#
#   GEM_HOME=$(dirname $(dirname $(readlink -f $(which pod))))/libexec \
#     ruby tools/i18n/xcode-localize.rb
#
# (on this Mac: GEM_HOME=/opt/homebrew/Cellar/cocoapods/1.17.0/libexec)
require 'xcodeproj'

root = File.expand_path('../..', __dir__)
project = Xcodeproj::Project.open(File.join(root, 'ios/Drift.xcodeproj'))
target = project.targets.find { |t| t.name == 'Drift' } or abort 'no Drift target'
codes = File.read(File.join(root, 'i18n/languages.js'), encoding: 'UTF-8').scan(/code: "([^"]+)"/).flatten - ['en']

group = project.main_group.find_subpath('Drift', false) or abort 'no Drift group'
variant = group.children.find { |c| c.isa == 'PBXVariantGroup' && c.name == 'InfoPlist.strings' }
unless variant
  variant = group.new_variant_group('InfoPlist.strings')
  target.resources_build_phase.add_file_reference(variant, true)
end
# The Drift group has no path of its own (its files carry "Drift/..."), so
# references must spell out the folder or Xcode looks in ios/.
prefix = group.path.to_s.empty? ? 'Drift/' : ''
codes.each do |code|
  want = "#{prefix}#{code}.lproj/InfoPlist.strings"
  ref = variant.children.find { |c| c.name == code }
  ref ||= variant.new_reference(want)
  ref.path = want
  ref.name = code
  ref.last_known_file_type = 'text.plist.strings'
end

# Drop languages no longer shipped (file reference and region).
variant.children.dup.each do |ref|
  next if codes.include?(ref.name)
  ref.remove_from_project
end

regions = project.root_object.known_regions
regions.delete_if { |r| !(['en', 'Base'] + codes).include?(r) }
(['en', 'Base'] + codes).each { |c| regions << c unless regions.include?(c) }
project.save
puts "InfoPlist.strings: #{variant.children.size} localizations; knownRegions: #{regions.size}"
