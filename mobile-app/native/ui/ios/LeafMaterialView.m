#import <React/RCTViewManager.h>
@interface RCT_EXTERN_MODULE(LeafMaterialViewManager, RCTViewManager)
@end

@interface RCT_EXTERN_MODULE(LeafRootTabViewManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(selectedTab, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(tabsVisible, BOOL)
RCT_EXPORT_VIEW_PROPERTY(onTabPress, RCTDirectEventBlock)
@end
