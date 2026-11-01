package tv.channeldock.player;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.GridLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

public final class MainActivity extends Activity {
    private static final int POSTER_WIDTH_DP = 175, POSTER_HEIGHT_DP = 263;
    private static final int INK = Color.rgb(246, 247, 250), MUTED = Color.rgb(157, 164, 178);
    private static final int DEEP = Color.rgb(8, 10, 14), PANEL = Color.rgb(29, 33, 43);
    private static final int CYAN = Color.rgb(143, 184, 255), AMBER = Color.rgb(143, 184, 255), LIVE = Color.rgb(232, 63, 111);
    private static final int FOCUS = Color.rgb(47, 128, 237), CARD = Color.rgb(35, 40, 52);
    private final ExecutorService network = Executors.newFixedThreadPool(3);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<JSONObject> entries = new ArrayList<>();
    private String serverUrl, filterMode = "All", sortMode = "Number";
    private ExoPlayer player;
    private PlayerView playerView;
    private int activeChannelId = -1;
    private FrameLayout playerFrame, detailPanel;
    private GridLayout channelList;
    private View guideOverlay;
    private boolean controllerVisible;
    private boolean standaloneGuide;
    private ImageView homeBackdrop;
    private Runnable pendingChannelPreview;
    private LinearLayout homeContent;
    private boolean homeDetailsOpen;
    private JSONObject homeSelectedEntry;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        serverUrl = getSharedPreferences("channeldock", MODE_PRIVATE).getString("server_url", "http://192.168.50.111:5173");
        showHome();
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView text(String value, float size, int color) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(color); return view;
    }
    private GradientDrawable bg(int color, int radius) {
        GradientDrawable result = new GradientDrawable(); result.setColor(color); result.setCornerRadius(dp(radius)); return result;
    }
    private Button tool(String label) {
        Button button = new Button(this); button.setAllCaps(false); button.setText(label); button.setTextColor(INK);
        button.setTextSize(15); button.setTypeface(Typeface.create("sans-serif-condensed", Typeface.BOLD)); button.setBackground(bg(PANEL, 8));
        button.setOnFocusChangeListener((view, focused) -> { button.setTextColor(INK); button.setBackground(bg(focused ? FOCUS : PANEL, 8)); });
        return button;
    }

    private String dateTimeNow(){return DateTimeFormatter.ofPattern("EEE d MMM  •  HH:mm").withZone(ZoneId.systemDefault()).format(Instant.now());}
    private TextView clockView(){TextView clock=text(dateTimeNow(),13,MUTED);clock.setGravity(Gravity.CENTER_VERTICAL);clock.setTypeface(Typeface.DEFAULT_BOLD);Runnable tick=new Runnable(){@Override public void run(){clock.setText(dateTimeNow());if(clock.isAttachedToWindow())main.postDelayed(this,30000);}};clock.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener(){@Override public void onViewAttachedToWindow(View v){main.removeCallbacks(tick);tick.run();}@Override public void onViewDetachedFromWindow(View v){main.removeCallbacks(tick);}});return clock;}

    private void showHome() {
        releasePlayer(); activeChannelId = -1; playerFrame = null; guideOverlay = null; standaloneGuide=false;homeDetailsOpen=false;homeSelectedEntry=null;
        FrameLayout root=new FrameLayout(this);root.setBackgroundColor(DEEP);homeBackdrop=new ImageView(this);homeBackdrop.setScaleType(ImageView.ScaleType.CENTER_CROP);homeBackdrop.setAlpha(.24f);root.addView(homeBackdrop,new FrameLayout.LayoutParams(-1,-1));
        LinearLayout page = new LinearLayout(this); page.setOrientation(LinearLayout.VERTICAL); page.setPadding(dp(52), dp(30), dp(52), dp(34));
        page.setBackground(new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, new int[]{Color.argb(246,8,10,14),Color.argb(220,8,10,14),Color.argb(242,8,10,14)}));
        LinearLayout header = new LinearLayout(this); header.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout brand = new LinearLayout(this); brand.setOrientation(LinearLayout.VERTICAL);
        TextView title = text("CHANNELDOCK", 24, INK); title.setTypeface(Typeface.create("sans-serif-black", Typeface.BOLD)); title.setLetterSpacing(.08f);
        brand.addView(title); brand.addView(text("Your Plex library, scheduled live", 14, MUTED));
        header.addView(brand, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        LinearLayout.LayoutParams clockP=new LinearLayout.LayoutParams(-2,dp(42));clockP.setMargins(0,0,dp(16),0);header.addView(clockView(),clockP);
        Button tv = tool("TV"), guideMenu=tool("GUIDE"), manage = tool("CHANNELS"), server = tool("SETTINGS");tv.setBackground(bg(FOCUS,8));
        tv.setOnClickListener(v->showHome());guideMenu.setOnClickListener(v->showGuidePage());manage.setOnClickListener(v -> showManagement());server.setOnClickListener(v -> editServer());
        for (Button button : new Button[]{tv,guideMenu,manage,server}) { LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(42)); p.setMargins(dp(8),0,0,0); header.addView(button,p); }
        page.addView(header, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(62)));
        homeContent=new LinearLayout(this);homeContent.setOrientation(LinearLayout.HORIZONTAL);homeContent.setPadding(0,dp(20),0,0);page.addView(homeContent,new LinearLayout.LayoutParams(-1,0,1));root.addView(page,new FrameLayout.LayoutParams(-1,-1));setContentView(root);homeContent.addView(text("Loading channels…",18,MUTED));
        request("/api/tv/channels", json -> { entries.clear(); JSONArray array=json.optJSONArray("channels"); if(array!=null) for(int i=0;i<array.length();i++){JSONObject e=array.optJSONObject(i);if(e!=null)entries.add(e);} renderHomeLayout(); });
    }

    private List<JSONObject> visibleEntries() {
        List<JSONObject> result=new ArrayList<>();
        for(JSONObject e:entries){JSONObject now=e.optJSONObject("current");String type=now==null?"":now.optString("type");if(filterMode.equals("Movies")&&!type.equals("movie"))continue;if(filterMode.equals("Series")&&!type.equals("episode"))continue;result.add(e);}
        if(sortMode.equals("Name"))result.sort(Comparator.comparing(e->e.optJSONObject("channel").optString("name"),String.CASE_INSENSITIVE_ORDER));
        else if(sortMode.equals("Now"))result.sort(Comparator.comparing(e->{JSONObject n=e.optJSONObject("current");return n==null?"":n.optString("title");},String.CASE_INSENSITIVE_ORDER));
        else result.sort(Comparator.comparingInt(e->e.optJSONObject("channel").optInt("number"))); return result;
    }

    private void renderHomeLayout(){if(homeContent==null)return;homeContent.removeAllViews();LinearLayout rail=new LinearLayout(this);rail.setOrientation(LinearLayout.VERTICAL);LinearLayout railTools=new LinearLayout(this);railTools.setGravity(Gravity.CENTER_VERTICAL);TextView railTitle=text("LIVE CHANNELS",13,INK);railTitle.setTypeface(Typeface.DEFAULT_BOLD);railTitle.setLetterSpacing(.12f);railTools.addView(railTitle,new LinearLayout.LayoutParams(0,-2,1));Button filter=tool(filterMode.toUpperCase()),sort=tool(sortMode.toUpperCase());filter.setTextSize(11);sort.setTextSize(11);filter.setOnClickListener(v->{filterMode=filterMode.equals("All")?"Movies":filterMode.equals("Movies")?"Series":"All";renderHomeLayout();});sort.setOnClickListener(v->{sortMode=sortMode.equals("Number")?"Name":sortMode.equals("Name")?"Now":"Number";renderHomeLayout();});railTools.addView(filter,new LinearLayout.LayoutParams(dp(82),dp(34)));LinearLayout.LayoutParams sortP=new LinearLayout.LayoutParams(dp(82),dp(34));sortP.setMargins(dp(6),0,0,0);railTools.addView(sort,sortP);rail.addView(railTools);ScrollView scroll=new ScrollView(this);scroll.setVerticalScrollBarEnabled(false);channelList=new GridLayout(this);channelList.setColumnCount(homeDetailsOpen?1:3);channelList.setAlignmentMode(GridLayout.ALIGN_BOUNDS);scroll.addView(channelList);LinearLayout.LayoutParams scrollP=new LinearLayout.LayoutParams(-1,0,1);scrollP.setMargins(0,dp(12),0,0);rail.addView(scroll,scrollP);homeContent.addView(rail,new LinearLayout.LayoutParams(0,-1,homeDetailsOpen?34:100));if(homeDetailsOpen){detailPanel=new FrameLayout(this);LinearLayout.LayoutParams detailP=new LinearLayout.LayoutParams(0,-1,66);detailP.setMargins(dp(18),0,0,0);homeContent.addView(detailPanel,detailP);if(homeSelectedEntry!=null){showDetails(detailPanel,homeSelectedEntry,false);detailPanel.setAlpha(0f);detailPanel.setTranslationX(-dp(120));detailPanel.animate().alpha(1f).translationX(0).setDuration(240).start();}}renderChannelCards();}

    private void renderChannelCards(){if(channelList==null)return;channelList.removeAllViews();List<JSONObject> visible=visibleEntries();if(visible.isEmpty()){channelList.addView(text("No channels match this filter.",18,MUTED));return;}View selected=null;for(JSONObject entry:visible){JSONObject channel=entry.optJSONObject("channel");if(channel==null)continue;LinearLayout card=new LinearLayout(this);card.setOrientation(LinearLayout.HORIZONTAL);card.setGravity(Gravity.CENTER_VERTICAL);card.setFocusable(true);card.setClickable(true);card.setPadding(dp(homeDetailsOpen?10:16),dp(8),dp(12),dp(8));card.setBackground(bg(PANEL,8));ImageView logo=new ImageView(this);logo.setScaleType(ImageView.ScaleType.FIT_CENTER);logo.setBackgroundColor(Color.rgb(22,25,33));int logoSize=dp(homeDetailsOpen?40:62);card.addView(logo,new LinearLayout.LayoutParams(logoSize,logoSize));loadImage(channel.optString("logoUrl"),logo);TextView label=text(channel.optInt("number")+"   "+channel.optString("name"),homeDetailsOpen?14:17,INK);label.setTypeface(Typeface.DEFAULT_BOLD);label.setMaxLines(2);label.setGravity(Gravity.CENTER_VERTICAL);LinearLayout.LayoutParams labelP=new LinearLayout.LayoutParams(0,-1,1);labelP.setMargins(dp(12),0,0,0);card.addView(label,labelP);card.setOnClickListener(v->openHomeDetails(entry));card.setOnFocusChangeListener((v,f)->{card.setBackground(bg(f?FOCUS:PANEL,8));if(pendingChannelPreview!=null)main.removeCallbacks(pendingChannelPreview);if(f){long delay=homeDetailsOpen?550:6000;pendingChannelPreview=()->{if(card.hasFocus()){if(homeDetailsOpen){homeSelectedEntry=entry;showDetails(detailPanel,entry,false);showHomeBackdrop(entry);}else openHomeDetails(entry);}};main.postDelayed(pendingChannelPreview,delay);}});GridLayout.LayoutParams p=new GridLayout.LayoutParams();p.width=0;p.height=dp(homeDetailsOpen?60:104);p.columnSpec=GridLayout.spec(GridLayout.UNDEFINED,1f);p.setMargins(0,0,dp(8),dp(8));channelList.addView(card,p);if(homeSelectedEntry!=null&&homeSelectedEntry.optJSONObject("channel").optInt("id")==channel.optInt("id"))selected=card;}if(selected!=null)selected.requestFocus();else channelList.getChildAt(0).requestFocus();}

    private void openHomeDetails(JSONObject entry){homeDetailsOpen=true;homeSelectedEntry=entry;showHomeBackdrop(entry);renderHomeLayout();}
    private void closeHomeDetails(){homeDetailsOpen=false;renderHomeLayout();}

    private void showHomeBackdrop(JSONObject entry){if(homeBackdrop==null)return;JSONObject now=entry.optJSONObject("current");if(now==null)return;String url=now.optString("backdropUrl",now.optString("artworkUrl"));loadImage(url,homeBackdrop);}

    private void showDetails(FrameLayout container, JSONObject entry, boolean compact) {
        container.removeAllViews();JSONObject channel=entry.optJSONObject("channel"),now=entry.optJSONObject("current"),next=entry.optJSONObject("next");if(now==null)return;
        LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.HORIZONTAL);panel.setPadding(dp(24),dp(24),dp(24),dp(24));panel.setBackground(bg(Color.rgb(22,25,33),12));
        ImageView poster=new ImageView(this);poster.setScaleType(ImageView.ScaleType.FIT_CENTER);poster.setAdjustViewBounds(false);poster.setBackgroundColor(PANEL);panel.addView(poster,new LinearLayout.LayoutParams(dp(POSTER_WIDTH_DP),dp(POSTER_HEIGHT_DP)));loadImage(now.optString("artworkUrl"),poster);
        LinearLayout copy=new LinearLayout(this);copy.setOrientation(LinearLayout.VERTICAL);copy.setPadding(dp(24),0,0,0);
        if(channel!=null)copy.addView(text("●  LIVE NOW   •   CHANNEL "+channel.optInt("number"),13,LIVE));
        TextView name=text(now.optString("title"),compact?24:31,INK);name.setTypeface(Typeface.DEFAULT_BOLD);LinearLayout.LayoutParams np=new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.WRAP_CONTENT);np.setMargins(0,dp(10),0,dp(6));copy.addView(name,np);
        copy.addView(text(facts(now),14,CYAN));TextView synopsis=text(now.optString("summary","No synopsis available."),compact?15:17,Color.rgb(203,220,227));synopsis.setLineSpacing(0,1.1f);synopsis.setPadding(dp(8),dp(6),dp(8),dp(6));ScrollView synopsisScroll=new ScrollView(this);synopsisScroll.setFocusable(true);synopsisScroll.setDescendantFocusability(ViewGroup.FOCUS_BLOCK_DESCENDANTS);synopsisScroll.setVerticalFadingEdgeEnabled(true);synopsisScroll.setFadingEdgeLength(dp(24));synopsisScroll.setOnFocusChangeListener((v,f)->synopsisScroll.setBackground(bg(f?Color.rgb(44,50,64):Color.TRANSPARENT,7)));synopsisScroll.addView(synopsis);LinearLayout.LayoutParams sp=new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,0,1);sp.setMargins(0,dp(12),0,dp(8));copy.addView(synopsisScroll,sp);
        if(next!=null)copy.addView(text("UP NEXT  •  "+next.optString("title"),14,AMBER));if(channel!=null&&!compact){Button watch=tool("WATCH CHANNEL");watch.setOnClickListener(v->playChannel(channel.optInt("id")));LinearLayout.LayoutParams watchP=new LinearLayout.LayoutParams(dp(170),dp(46));watchP.setMargins(0,dp(10),0,0);copy.addView(watch,watchP);}panel.addView(copy,new LinearLayout.LayoutParams(0,ViewGroup.LayoutParams.MATCH_PARENT,1));container.addView(panel,new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private String facts(JSONObject now){List<String> f=new ArrayList<>();if(now.optInt("year")>0)f.add(String.valueOf(now.optInt("year")));String r=now.optString("contentRating");if(!r.isEmpty()&&!r.equals("null"))f.add(r);if(now.optLong("durationMs")>0)f.add(now.optLong("durationMs")/60000+" min");return String.join("   •   ",f);}

    private void showManagement(){
        releasePlayer(); activeChannelId=-1; playerFrame=null; guideOverlay=null; standaloneGuide=false;homeDetailsOpen=false;
        LinearLayout page=new LinearLayout(this);page.setOrientation(LinearLayout.VERTICAL);page.setPadding(dp(52),dp(24),dp(52),dp(30));page.setBackground(new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,new int[]{Color.rgb(8,10,14),Color.rgb(18,21,28),Color.rgb(8,10,14)}));
        LinearLayout header=new LinearLayout(this);header.setGravity(Gravity.CENTER_VERTICAL);LinearLayout heading=new LinearLayout(this);heading.setOrientation(LinearLayout.VERTICAL);TextView title=text("CHANNELDOCK",24,INK);title.setTypeface(Typeface.create("sans-serif-black",Typeface.BOLD));title.setLetterSpacing(.08f);heading.addView(title);heading.addView(text("Channel management",14,MUTED));header.addView(heading,new LinearLayout.LayoutParams(0,-2,1));LinearLayout.LayoutParams clockP=new LinearLayout.LayoutParams(-2,dp(42));clockP.setMargins(0,0,dp(16),0);header.addView(clockView(),clockP);Button tv=tool("TV"),guide=tool("GUIDE"),channelsMenu=tool("CHANNELS"),settings=tool("SETTINGS");channelsMenu.setBackground(bg(FOCUS,8));tv.setOnClickListener(v->showHome());guide.setOnClickListener(v->showGuidePage());settings.setOnClickListener(v->editServer());for(Button button:new Button[]{tv,guide,channelsMenu,settings}){LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-2,dp(42));p.setMargins(dp(8),0,0,0);header.addView(button,p);}page.addView(header,new LinearLayout.LayoutParams(-1,dp(62)));
        LinearLayout content=new LinearLayout(this);content.setOrientation(LinearLayout.HORIZONTAL);content.setPadding(0,dp(20),0,0);LinearLayout rows=new LinearLayout(this);rows.setOrientation(LinearLayout.VERTICAL);ScrollView scroll=new ScrollView(this);scroll.setVerticalScrollBarEnabled(false);scroll.addView(rows);content.addView(scroll,new LinearLayout.LayoutParams(0,-1,46));FrameLayout details=new FrameLayout(this);LinearLayout.LayoutParams detailsP=new LinearLayout.LayoutParams(0,-1,54);detailsP.setMargins(dp(26),0,0,0);content.addView(details,detailsP);page.addView(content,new LinearLayout.LayoutParams(-1,0,1));setContentView(page);rows.addView(text("Loading channels…",18,MUTED));
        request("/api/channels",json->{rows.removeAllViews();JSONArray channels=json.optJSONArray("channels");if(channels==null||channels.length()==0){rows.addView(text("No channels have been created.",18,MUTED));return;}for(int i=0;i<channels.length();i++){JSONObject channel=channels.optJSONObject(i);if(channel==null)continue;Button row=tool((channel.optBoolean("isActive")?"●  ON":"○  OFF")+"     "+channel.optInt("number")+"     "+channel.optString("name"));row.setGravity(Gravity.START|Gravity.CENTER_VERTICAL);row.setTextSize(16);row.setOnClickListener(v->showManagementDetails(details,channel));row.setOnFocusChangeListener((v,f)->{row.setBackground(bg(f?FOCUS:PANEL,8));row.setTextColor(INK);if(f)showManagementDetails(details,channel);});LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,dp(60));p.setMargins(0,0,0,dp(7));rows.addView(row,p);}JSONObject first=channels.optJSONObject(0);if(first!=null)showManagementDetails(details,first);if(rows.getChildCount()>0)rows.getChildAt(0).requestFocus();});
    }

    private void showManagementDetails(FrameLayout container,JSONObject channel){
        container.removeAllViews();LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.HORIZONTAL);panel.setPadding(dp(28),dp(28),dp(28),dp(28));panel.setBackground(bg(Color.rgb(22,25,33),12));ImageView logo=new ImageView(this);logo.setScaleType(ImageView.ScaleType.FIT_CENTER);logo.setBackgroundColor(PANEL);panel.addView(logo,new LinearLayout.LayoutParams(dp(180),dp(270)));String logoUrl=channel.optBoolean("hasCustomLogo")?serverUrl+"/channel-logo/"+channel.optInt("id"):channel.isNull("logoRatingKey")?"":serverUrl+"/artwork/"+channel.optString("logoRatingKey");loadImage(logoUrl,logo);
        LinearLayout copy=new LinearLayout(this);copy.setOrientation(LinearLayout.VERTICAL);copy.setPadding(dp(28),0,0,0);copy.addView(text(channel.optBoolean("isActive")?"●  CHANNEL IN USE":"○  CHANNEL NOT IN USE",13,channel.optBoolean("isActive")?LIVE:MUTED));TextView name=text(channel.optString("name"),30,INK);name.setTypeface(Typeface.DEFAULT_BOLD);LinearLayout.LayoutParams nameP=new LinearLayout.LayoutParams(-1,-2);nameP.setMargins(0,dp(12),0,dp(8));copy.addView(name,nameP);copy.addView(text("Channel "+channel.optInt("number")+"   •   "+(channel.optString("playbackOrder").equals("sequential")?"In order":"Shuffle"),16,CYAN));copy.addView(text("Media and logo editing are available in the ChannelDock browser.",14,MUTED),new LinearLayout.LayoutParams(-1,0,1));
        LinearLayout actions=new LinearLayout(this);actions.setOrientation(LinearLayout.HORIZONTAL);Button toggle=tool(channel.optBoolean("isActive")?"Turn off":"Turn on"),edit=tool("Edit settings"),remove=tool("Remove");toggle.setOnClickListener(v->toggleManagedChannel(channel));edit.setOnClickListener(v->editManagedChannel(channel));remove.setOnClickListener(v->removeManagedChannel(channel));for(Button button:new Button[]{toggle,edit,remove}){LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,dp(54),1);p.setMargins(0,0,dp(10),0);actions.addView(button,p);}copy.addView(actions);panel.addView(copy,new LinearLayout.LayoutParams(0,-1,1));container.addView(panel,new FrameLayout.LayoutParams(-1,-1));
    }

    private void toggleManagedChannel(JSONObject channel){try{JSONObject body=new JSONObject().put("active",!channel.optBoolean("isActive"));requestJson("PATCH","/api/channels/"+channel.optInt("id")+"/active",body,json->{toast(channel.optBoolean("isActive")?"Channel turned off":"Channel turned on");showManagement();});}catch(Exception e){toast(e.getMessage());}}

    private void editManagedChannel(JSONObject channel){
        LinearLayout form=new LinearLayout(this);form.setOrientation(LinearLayout.VERTICAL);int pad=dp(20);form.setPadding(pad,0,pad,0);EditText name=new EditText(this);name.setHint("Channel name");name.setText(channel.optString("name"));EditText number=new EditText(this);number.setHint("Channel number");number.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);number.setText(String.valueOf(channel.optInt("number")));Button order=tool(channel.optString("playbackOrder").equals("sequential")?"Order: In order":"Order: Shuffle");final boolean[] sequential={channel.optString("playbackOrder").equals("sequential")};order.setOnClickListener(v->{sequential[0]=!sequential[0];order.setText(sequential[0]?"Order: In order":"Order: Shuffle");});form.addView(name,new LinearLayout.LayoutParams(-1,dp(62)));form.addView(number,new LinearLayout.LayoutParams(-1,dp(62)));LinearLayout.LayoutParams orderP=new LinearLayout.LayoutParams(-1,dp(54));orderP.setMargins(0,dp(12),0,0);form.addView(order,orderP);
        new AlertDialog.Builder(this).setTitle("Edit channel").setView(form).setNegativeButton("Cancel",null).setPositiveButton("Save",(dialog,which)->{try{String nextName=name.getText().toString().trim();int nextNumber=Integer.parseInt(number.getText().toString().trim());JSONObject body=new JSONObject().put("name",nextName).put("number",nextNumber).put("playbackOrder",sequential[0]?"sequential":"shuffle");requestJson("PATCH","/api/channels/"+channel.optInt("id")+"/settings",body,json->{toast("Channel updated");showManagement();});}catch(Exception e){toast("Enter a valid name and channel number");}}).show();
    }

    private void removeManagedChannel(JSONObject channel){new AlertDialog.Builder(this).setTitle("Remove channel?").setMessage(channel.optString("name")+" will be permanently removed.").setNegativeButton("Cancel",null).setPositiveButton("Remove",(dialog,which)->requestJson("DELETE","/api/channels/"+channel.optInt("id"),null,json->{toast("Channel removed");showManagement();})).show();}

    private void editServer(){EditText input=new EditText(this);input.setSingleLine();input.setText(serverUrl);input.setSelectAllOnFocus(true);new AlertDialog.Builder(this).setTitle("ChannelDock server").setMessage("Use the LAN address, for example http://192.168.50.111:5173").setView(input).setNegativeButton("Cancel",null).setPositiveButton("Connect",(d,w)->{serverUrl=input.getText().toString().trim().replaceAll("/+$","");getSharedPreferences("channeldock",MODE_PRIVATE).edit().putString("server_url",serverUrl).apply();showHome();}).show();}

    private void playChannel(int id){activeChannelId=id;request("/api/tv/channels/"+id+"/now",json->{JSONObject now=json.optJSONObject("current"),channel=json.optJSONObject("channel"),next=json.optJSONObject("next");if(now==null||channel==null){toast("Nothing is scheduled on this channel");return;}startPlayer(now.optString("mediaUrl"),now.optLong("offsetMs"),channel.optString("name"),now.optString("title"),next==null?"":next.optString("title"));});}

    private void startPlayer(String url,long offset,String channel,String title,String next){releasePlayer();guideOverlay=null;standaloneGuide=false;homeDetailsOpen=false;controllerVisible=false;playerFrame=new FrameLayout(this);playerFrame.setBackgroundColor(Color.BLACK);PlayerView view=new PlayerView(this);playerView=view;view.setUseController(true);playerFrame.addView(view,new FrameLayout.LayoutParams(-1,-1));
        TextView info=text(channel+"   •   "+dateTimeNow()+"\n"+title+(next.isEmpty()?"":"   •   Up next: "+next),18,Color.WHITE);info.setBackgroundColor(Color.argb(190,8,16,22));info.setPadding(dp(24),dp(14),dp(24),dp(14));playerFrame.addView(info,new FrameLayout.LayoutParams(-1,-2,Gravity.TOP));
        view.setControllerShowTimeoutMs(5000);view.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener)visibility->{controllerVisible=visibility==View.VISIBLE;info.setVisibility(visibility);});setContentView(playerFrame);
        player=new ExoPlayer.Builder(this).build();view.setPlayer(player);player.addListener(new Player.Listener(){@Override public void onPlaybackStateChanged(int state){if(state==Player.STATE_ENDED&&activeChannelId>0)main.postDelayed(()->playChannel(activeChannelId),300);}@Override public void onPlayerError(PlaybackException e){toast("Playback failed: "+e.getErrorCodeName());}});player.setMediaItem(new MediaItem.Builder().setUri(Uri.parse(url)).build(),Math.max(0,offset));player.prepare();player.play();}

    private void showGuidePage(){releasePlayer();activeChannelId=-1;homeDetailsOpen=false;standaloneGuide=true;playerFrame=new FrameLayout(this);playerFrame.setBackgroundColor(DEEP);setContentView(playerFrame);showGuide();}

    private void showGuide(){if(playerFrame==null||guideOverlay!=null)return;boolean pip=player!=null&&playerView!=null&&!standaloneGuide;FrameLayout overlay=new FrameLayout(this);overlay.setBackgroundColor(Color.argb(pip?218:248,8,10,14));guideOverlay=overlay;playerFrame.addView(overlay,new FrameLayout.LayoutParams(-1,-1));LinearLayout shell=new LinearLayout(this);shell.setOrientation(LinearLayout.VERTICAL);shell.setPadding(dp(34),dp(16),dp(34),dp(18));overlay.addView(shell,new FrameLayout.LayoutParams(-1,-1));
        LinearLayout header=new LinearLayout(this);header.setGravity(Gravity.CENTER_VERTICAL);TextView heading=text("CHANNELDOCK",24,INK);heading.setTypeface(Typeface.create("sans-serif-black",Typeface.BOLD));heading.setLetterSpacing(.08f);header.addView(heading,new LinearLayout.LayoutParams(0,-2,1));LinearLayout.LayoutParams clockP=new LinearLayout.LayoutParams(-2,dp(42));clockP.setMargins(0,0,dp(16),0);header.addView(clockView(),clockP);Button tv=tool("TV"),guide=tool("GUIDE"),channels=tool("CHANNELS"),settings=tool("SETTINGS");guide.setBackground(bg(FOCUS,8));tv.setOnClickListener(v->showHome());channels.setOnClickListener(v->showManagement());settings.setOnClickListener(v->editServer());for(Button button:new Button[]{tv,guide,channels,settings}){LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-2,dp(42));p.setMargins(dp(7),0,0,0);header.addView(button,p);}shell.addView(header,new LinearLayout.LayoutParams(-1,dp(48)));
        LinearLayout hero=new LinearLayout(this);hero.setOrientation(LinearLayout.HORIZONTAL);FrameLayout details=new FrameLayout(this);hero.addView(details,new LinearLayout.LayoutParams(0,-1,1));if(pip){FrameLayout videoWindow=new FrameLayout(this);videoWindow.setBackgroundColor(Color.BLACK);LinearLayout.LayoutParams videoP=new LinearLayout.LayoutParams(dp(320),dp(180));videoP.setMargins(dp(14),0,0,0);hero.addView(videoWindow,videoP);movePlayerToGuide(videoWindow);}LinearLayout.LayoutParams heroP=new LinearLayout.LayoutParams(-1,dp(180));heroP.setMargins(0,dp(8),0,dp(8));shell.addView(hero,heroP);
        LinearLayout gridHeader=new LinearLayout(this);gridHeader.setGravity(Gravity.CENTER_VERTICAL);TextView guideTitle=text("24-HOUR GUIDE",15,INK);guideTitle.setTypeface(Typeface.DEFAULT_BOLD);gridHeader.addView(guideTitle,new LinearLayout.LayoutParams(0,-2,1));gridHeader.addView(text("← → programmes    ↑ ↓ channels    OK tune    Back close",12,MUTED));shell.addView(gridHeader,new LinearLayout.LayoutParams(-1,dp(28)));
        LinearLayout axis=new LinearLayout(this);axis.setOrientation(LinearLayout.HORIZONTAL);TextView labelHead=text("CHANNEL",11,MUTED);labelHead.setGravity(Gravity.CENTER_VERTICAL);axis.addView(labelHead,new LinearLayout.LayoutParams(dp(215),dp(34)));HorizontalScrollView timeScroll=new HorizontalScrollView(this);timeScroll.setHorizontalScrollBarEnabled(false);LinearLayout times=new LinearLayout(this);times.setOrientation(LinearLayout.HORIZONTAL);timeScroll.addView(times);LinearLayout.LayoutParams timeP=new LinearLayout.LayoutParams(0,dp(34),1);timeP.setMargins(dp(7),0,0,0);axis.addView(timeScroll,timeP);shell.addView(axis,new LinearLayout.LayoutParams(-1,dp(34)));
        ScrollView vertical=new ScrollView(this);vertical.setVerticalScrollBarEnabled(false);LinearLayout grid=new LinearLayout(this);grid.setOrientation(LinearLayout.HORIZONTAL);LinearLayout labels=new LinearLayout(this);labels.setOrientation(LinearLayout.VERTICAL);grid.addView(labels,new LinearLayout.LayoutParams(dp(215),-2));HorizontalScrollView horizontal=new HorizontalScrollView(this);horizontal.setHorizontalScrollBarEnabled(false);LinearLayout timeline=new LinearLayout(this);timeline.setOrientation(LinearLayout.VERTICAL);horizontal.addView(timeline);LinearLayout.LayoutParams timelineP=new LinearLayout.LayoutParams(0,-2,1);timelineP.setMargins(dp(7),0,0,0);grid.addView(horizontal,timelineP);horizontal.setOnScrollChangeListener((v,x,y,oldX,oldY)->{if(timeScroll.getScrollX()!=x)timeScroll.scrollTo(x,0);});timeScroll.setOnScrollChangeListener((v,x,y,oldX,oldY)->{if(horizontal.getScrollX()!=x)horizontal.scrollTo(x,0);});vertical.addView(grid);shell.addView(vertical,new LinearLayout.LayoutParams(-1,0,1));
        request("/api/tv/channels",tvJson->request("/api/schedules?hours=24",scheduleJson->renderEpgGuide(tvJson.optJSONArray("channels"),scheduleJson.optJSONArray("schedules"),labels,timeline,times,details)));}

    private void renderEpgGuide(JSONArray channels,JSONArray schedules,LinearLayout labels,LinearLayout timeline,LinearLayout times,FrameLayout details){if(channels==null)return;Instant now=Instant.now();for(int hour=0;hour<24;hour++){TextView tick=text(guideTime(now.plusSeconds(hour*3600L).toString()),11,MUTED);tick.setGravity(Gravity.START|Gravity.CENTER_VERTICAL);times.addView(tick,new LinearLayout.LayoutParams(dp(180),dp(34)));}final View[] firstFocus={null};for(int i=0;i<channels.length();i++){JSONObject entry=channels.optJSONObject(i);if(entry==null)continue;JSONObject channel=entry.optJSONObject("channel"),current=entry.optJSONObject("current");if(channel==null)continue;int channelId=channel.optInt("id");JSONArray programmes=findProgrammes(schedules,channelId);Button label=tool(channel.optInt("number")+"   "+channel.optString("name")+"\n"+(current==null?"Off air":current.optString("title")));label.setGravity(Gravity.START|Gravity.CENTER_VERTICAL);label.setTextSize(13);label.setOnClickListener(v->playChannel(channelId));label.setOnFocusChangeListener((v,f)->{label.setBackground(bg(f?FOCUS:channelId==activeChannelId?CARD:PANEL,7));if(f&&current!=null)showEpgDetails(details,channel,current);});LinearLayout.LayoutParams labelP=new LinearLayout.LayoutParams(-1,dp(56));labelP.setMargins(0,0,0,dp(4));labels.addView(label,labelP);
            LinearLayout programmeRow=new LinearLayout(this);programmeRow.setOrientation(LinearLayout.HORIZONTAL);for(int p=0;p<programmes.length();p++){JSONObject programme=programmes.optJSONObject(p);if(programme==null)continue;Instant end=parseInstant(programme.optString("end"));if(end==null||!end.isAfter(now))continue;Instant start=parseInstant(programme.optString("start"));long minutes=Math.max(10,Duration.between(start!=null&&start.isAfter(now)?start:now,end).toMinutes());boolean currentProgramme=isCurrent(programme);Button block=tool((currentProgramme?"NOW  ":guideTime(programme.optString("start"))+"  ")+programme.optString("title"));block.setGravity(Gravity.START|Gravity.CENTER_VERTICAL);block.setTextSize(13);block.setSingleLine(true);block.setOnClickListener(v->playChannel(channelId));block.setOnFocusChangeListener((v,f)->{block.setBackground(bg(f?FOCUS:currentProgramme?Color.rgb(52,57,72):PANEL,7));if(f)showEpgDetails(details,channel,programme);});if(currentProgramme)block.setBackground(bg(Color.rgb(52,57,72),7));LinearLayout.LayoutParams blockP=new LinearLayout.LayoutParams(dp((int)(minutes*3)),dp(56));blockP.setMargins(0,0,dp(4),dp(4));programmeRow.addView(block,blockP);if(firstFocus[0]==null&&(channelId==activeChannelId||activeChannelId<0)&&currentProgramme)firstFocus[0]=block;}timeline.addView(programmeRow,new LinearLayout.LayoutParams(-2,dp(60)));if(current!=null&&(firstFocus[0]==null||channelId==activeChannelId))showEpgDetails(details,channel,current);}if(firstFocus[0]!=null)firstFocus[0].requestFocus();else if(labels.getChildCount()>0)labels.getChildAt(0).requestFocus();}

    private JSONArray findProgrammes(JSONArray schedules,int channelId){if(schedules!=null)for(int i=0;i<schedules.length();i++){JSONObject schedule=schedules.optJSONObject(i);if(schedule!=null&&schedule.optInt("channelId")==channelId){JSONArray programmes=schedule.optJSONArray("programmes");return programmes==null?new JSONArray():programmes;}}return new JSONArray();}

    private void showEpgDetails(FrameLayout details,JSONObject channel,JSONObject programme){details.removeAllViews();LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.HORIZONTAL);panel.setPadding(dp(14),dp(11),dp(14),dp(11));panel.setBackground(bg(Color.rgb(22,25,33),10));ImageView poster=new ImageView(this);poster.setScaleType(ImageView.ScaleType.FIT_CENTER);poster.setBackgroundColor(PANEL);panel.addView(poster,new LinearLayout.LayoutParams(dp(82),dp(123)));loadImage(serverUrl+"/artwork/"+Uri.encode(programme.optString("ratingKey")),poster);LinearLayout copy=new LinearLayout(this);copy.setOrientation(LinearLayout.VERTICAL);copy.setPadding(dp(16),0,0,0);TextView live=text(isCurrent(programme)?"NOW PLAYING  •  CHANNEL "+channel.optInt("number"):guideTime(programme.optString("start"))+"–"+guideTime(programme.optString("end"))+"  •  CHANNEL "+channel.optInt("number"),11,isCurrent(programme)?LIVE:CYAN);live.setTypeface(Typeface.DEFAULT_BOLD);copy.addView(live);TextView title=text(programme.optString("title"),23,INK);title.setTypeface(Typeface.DEFAULT_BOLD);LinearLayout.LayoutParams titleP=new LinearLayout.LayoutParams(-1,-2);titleP.setMargins(0,dp(5),0,dp(3));copy.addView(title,titleP);copy.addView(text(facts(programme),12,MUTED));TextView summary=text(programme.optString("summary","No synopsis available."),13,Color.rgb(211,214,222));summary.setMaxLines(3);LinearLayout.LayoutParams summaryP=new LinearLayout.LayoutParams(-1,0,1);summaryP.setMargins(0,dp(6),0,0);copy.addView(summary,summaryP);panel.addView(copy,new LinearLayout.LayoutParams(0,-1,1));details.addView(panel,new FrameLayout.LayoutParams(-1,-1));}

    private boolean isCurrent(JSONObject programme){try{Instant now=Instant.now();return !now.isBefore(Instant.parse(programme.optString("start")))&&now.isBefore(Instant.parse(programme.optString("end")));}catch(Exception e){return false;}}
    private Instant parseInstant(String value){try{return Instant.parse(value);}catch(Exception e){return null;}}
    private String guideTime(String value){try{return DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(value));}catch(Exception e){return "--:--";}}

    private long remaining(String end){try{return Math.max(0,Duration.between(Instant.now(),Instant.parse(end)).toMinutes());}catch(Exception e){return 0;}}
    private void movePlayerToGuide(FrameLayout window){if(playerView==null)return;ViewGroup parent=(ViewGroup)playerView.getParent();if(parent!=null)parent.removeView(playerView);playerView.hideController();playerView.setUseController(false);window.addView(playerView,new FrameLayout.LayoutParams(-1,-1));}
    private void restorePlayerFromGuide(){if(playerView==null||playerFrame==null||playerView.getParent()==playerFrame)return;ViewGroup parent=(ViewGroup)playerView.getParent();if(parent!=null)parent.removeView(playerView);playerView.setUseController(true);playerFrame.addView(playerView,0,new FrameLayout.LayoutParams(-1,-1));}
    private void closeGuide(){if(standaloneGuide){showHome();return;}restorePlayerFromGuide();if(guideOverlay!=null&&playerFrame!=null)playerFrame.removeView(guideOverlay);guideOverlay=null;}

    private void loadImage(String url,ImageView target){if(url==null||url.isEmpty()||url.equals("null"))return;target.setTag(url);network.execute(()->{HttpURLConnection c=null;try{c=(HttpURLConnection)new URL(url).openConnection();c.setConnectTimeout(8000);c.setReadTimeout(15000);Bitmap bitmap;try(InputStream in=c.getInputStream()){bitmap=BitmapFactory.decodeStream(in);}main.post(()->{if(url.equals(target.getTag()))target.setImageBitmap(bitmap);});}catch(Exception ignored){}finally{if(c!=null)c.disconnect();}});}
    private void request(String path,Consumer<JSONObject> success){requestJson("GET",path,null,success);}
    private void requestJson(String method,String path,JSONObject body,Consumer<JSONObject> success){network.execute(()->{HttpURLConnection c=null;try{c=(HttpURLConnection)new URL(serverUrl+path).openConnection();c.setRequestMethod(method);c.setConnectTimeout(8000);c.setReadTimeout(20000);if(body!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream out=c.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}}int status=c.getResponseCode();InputStream stream=status>=200&&status<300?c.getInputStream():c.getErrorStream();StringBuilder value=new StringBuilder();if(stream!=null)try(BufferedReader reader=new BufferedReader(new InputStreamReader(stream,StandardCharsets.UTF_8))){String line;while((line=reader.readLine())!=null)value.append(line);}if(status<200||status>=300){String message="Server returned "+status;try{JSONObject error=new JSONObject(value.toString());message=error.optString("error",message);}catch(Exception ignored){}throw new IllegalStateException(message);}JSONObject json=value.length()==0?new JSONObject():new JSONObject(value.toString());main.post(()->success.accept(json));}catch(Exception e){main.post(()->toast("Cannot reach ChannelDock: "+e.getMessage()));}finally{if(c!=null)c.disconnect();}});}
    private void toast(String message){Toast.makeText(this,message,Toast.LENGTH_LONG).show();}
    private void releasePlayer(){if(player!=null){player.release();player=null;}playerView=null;}

    private void tuneAdjacent(int direction){List<JSONObject> channels=visibleEntries();if(channels.isEmpty())return;int position=0;for(int i=0;i<channels.size();i++){JSONObject channel=channels.get(i).optJSONObject("channel");if(channel!=null&&channel.optInt("id")==activeChannelId){position=i;break;}}int next=(position+direction+channels.size())%channels.size();JSONObject channel=channels.get(next).optJSONObject("channel");if(channel!=null)playChannel(channel.optInt("id"));}
    @Override public boolean dispatchKeyEvent(KeyEvent event){if(event.getAction()==KeyEvent.ACTION_DOWN&&player!=null&&guideOverlay==null){int key=event.getKeyCode();if((key==KeyEvent.KEYCODE_DPAD_DOWN&&!controllerVisible)||key==KeyEvent.KEYCODE_GUIDE||key==KeyEvent.KEYCODE_MENU){showGuide();return true;}if(key==KeyEvent.KEYCODE_DPAD_UP&&!controllerVisible){if(playerView!=null)playerView.showController();return true;}if(key==KeyEvent.KEYCODE_CHANNEL_UP){tuneAdjacent(-1);return true;}if(key==KeyEvent.KEYCODE_CHANNEL_DOWN){tuneAdjacent(1);return true;}}return super.dispatchKeyEvent(event);}
    @Override public boolean onKeyUp(int keyCode,KeyEvent event){if(keyCode==KeyEvent.KEYCODE_BACK&&guideOverlay!=null){closeGuide();return true;}if(keyCode==KeyEvent.KEYCODE_BACK&&player!=null){showHome();return true;}if(keyCode==KeyEvent.KEYCODE_BACK&&homeDetailsOpen){closeHomeDetails();return true;}return super.onKeyUp(keyCode,event);}
    @Override protected void onDestroy(){releasePlayer();network.shutdownNow();super.onDestroy();}
}
